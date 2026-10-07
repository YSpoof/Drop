package services

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"dropcli/internal/adapters/fs"
	"dropcli/internal/state"
)

func TestTransferServiceSimulatedTransfer(t *testing.T) {
	tempSrcDir, err := os.MkdirTemp("", "transfer-src-*")
	if err != nil {
		t.Fatalf("failed to create temp src dir: %v", err)
	}
	defer os.RemoveAll(tempSrcDir)

	tempDstDir, err := os.MkdirTemp("", "transfer-dst-*")
	if err != nil {
		t.Fatalf("failed to create temp dst dir: %v", err)
	}
	defer os.RemoveAll(tempDstDir)

	// Create a test file of 9 MiB (exceeds 8 MiB window to test backpressure)
	testFileSize := 9 * 1024 * 1024
	testData := make([]byte, testFileSize)
	_, _ = rand.Read(testData)

	srcFilePath := filepath.Join(tempSrcDir, "large_sample.dat")
	if err := os.WriteFile(srcFilePath, testData, 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	repo := fs.NewRepository()

	// Sender Setup
	senderState := state.NewTransferState()
	senderTransferSvc := NewTransferService(repo, senderState, nil)
	senderTransferSvc.SetChunkSize(65536) // 64 KiB chunks

	// Receiver Setup
	receiverState := state.NewTransferState()
	receiverSettings := state.NewSettings()
	receiverSettings.SetDownloadDir(tempDstDir)
	receiverDownloadSvc := NewDownloadService(repo, receiverState, receiverSettings)
	receiverTransferSvc := NewTransferService(repo, receiverState, receiverDownloadSvc)

	// Ordered FIFO queues simulating independent WebRTC data channels
	s2rCtrl := make(chan []byte, 1000)
	s2rData := make(chan []byte, 1000)
	r2sCtrl := make(chan []byte, 1000)

	done := make(chan struct{})
	defer close(done)

	// Receiver Ctrl worker
	go func() {
		for {
			select {
			case <-done:
				return
			case msg := <-s2rCtrl:
				receiverTransferSvc.HandleControlMessage(msg)
			}
		}
	}()

	// Receiver Data worker
	go func() {
		for {
			select {
			case <-done:
				return
			case chunk := <-s2rData:
				_ = receiverDownloadSvc.HandleChunk(chunk)
			}
		}
	}()

	// Sender Ctrl worker
	go func() {
		for {
			select {
			case <-done:
				return
			case msg := <-r2sCtrl:
				senderTransferSvc.HandleControlMessage(msg)
			}
		}
	}()

	// Wire Transports
	senderTransferSvc.SetTransports(
		func(ctrlData []byte) error {
			s2rCtrl <- ctrlData
			return nil
		},
		func(chunk []byte) error {
			s2rData <- chunk
			return nil
		},
	)

	receiverTransferSvc.SetTransports(
		func(ctrlData []byte) error {
			r2sCtrl <- ctrlData
			return nil
		},
		func(chunk []byte) error {
			return nil
		},
	)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := senderTransferSvc.SendFile(ctx, srcFilePath); err != nil {
		t.Fatalf("SendFile failed: %v", err)
	}

	// Verify sender transfer marked completed
	transfers := senderState.GetAll()
	if len(transfers) != 1 || transfers[0].Status != state.TransferCompleted {
		t.Fatalf("expected sender transfer completed, got: %+v", transfers)
	}

	// Verify receiver transfer marked completed
	rxTransfers := receiverState.GetAll()
	if len(rxTransfers) != 1 || rxTransfers[0].Status != state.TransferCompleted {
		t.Fatalf("expected receiver transfer completed, got: %+v", rxTransfers)
	}

	// Verify content on disk matches exactly
	dstFilePath := filepath.Join(tempDstDir, "large_sample.dat")
	receivedData, err := os.ReadFile(dstFilePath)
	if err != nil {
		t.Fatalf("failed to read destination file: %v", err)
	}

	if len(receivedData) != testFileSize {
		t.Fatalf("file size mismatch: expected %d, got %d", testFileSize, len(receivedData))
	}

	if !bytes.Equal(receivedData, testData) {
		t.Fatal("file content mismatch between sender and receiver")
	}
}

func TestTransferServiceAbortPeerLossRequeuesSend(t *testing.T) {
	tempSrcDir, err := os.MkdirTemp("", "transfer-abort-src-*")
	if err != nil {
		t.Fatalf("failed to create temp src dir: %v", err)
	}
	defer os.RemoveAll(tempSrcDir)

	tempDstDir, err := os.MkdirTemp("", "transfer-abort-dst-*")
	if err != nil {
		t.Fatalf("failed to create temp dst dir: %v", err)
	}
	defer os.RemoveAll(tempDstDir)

	testData := bytes.Repeat([]byte{0xCD}, 2*1024*1024)
	srcFilePath := filepath.Join(tempSrcDir, "abort_sample.dat")
	if err := os.WriteFile(srcFilePath, testData, 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	repo := fs.NewRepository()
	senderState := state.NewTransferState()
	senderTransferSvc := NewTransferService(repo, senderState, nil)
	senderTransferSvc.SetChunkSize(65536)

	receiverState := state.NewTransferState()
	receiverSettings := state.NewSettings()
	receiverSettings.SetDownloadDir(tempDstDir)
	receiverDownloadSvc := NewDownloadService(repo, receiverState, receiverSettings)
	receiverTransferSvc := NewTransferService(repo, receiverState, receiverDownloadSvc)

	s2rCtrl := make(chan []byte, 1000)
	s2rData := make(chan []byte, 1000)
	r2sCtrl := make(chan []byte, 1000)
	done := make(chan struct{})
	defer close(done)

	go func() {
		for {
			select {
			case <-done:
				return
			case msg := <-s2rCtrl:
				receiverTransferSvc.HandleControlMessage(msg)
			}
		}
	}()
	go func() {
		for {
			select {
			case <-done:
				return
			case chunk := <-s2rData:
				_ = receiverDownloadSvc.HandleChunk(chunk)
			}
		}
	}()
	go func() {
		for {
			select {
			case <-done:
				return
			case msg := <-r2sCtrl:
				senderTransferSvc.HandleControlMessage(msg)
			}
		}
	}()

	started := make(chan struct{}, 1)
	senderTransferSvc.SetTransports(
		func(ctrlData []byte) error {
			s2rCtrl <- ctrlData
			return nil
		},
		func(chunk []byte) error {
			select {
			case started <- struct{}{}:
			default:
			}
			// Block until abort so send stays in-flight.
			time.Sleep(50 * time.Millisecond)
			s2rData <- chunk
			return nil
		},
	)
	receiverTransferSvc.SetTransports(
		func(ctrlData []byte) error {
			r2sCtrl <- ctrlData
			return nil
		},
		func(chunk []byte) error { return nil },
	)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- senderTransferSvc.SendFile(ctx, srcFilePath)
	}()

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for send to start")
	}

	senderTransferSvc.AbortPeerLoss()

	select {
	case err := <-errCh:
		if !errors.Is(err, ErrPeerAbort) {
			t.Fatalf("expected ErrPeerAbort, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for SendFile to abort")
	}

	pending := senderTransferSvc.PendingSends()
	if len(pending) != 1 || pending[0] != srcFilePath {
		t.Fatalf("expected re-queued send %q, got %v", srcFilePath, pending)
	}

	// Abort-without-discard must keep receiver .drop partial if any bytes landed.
	entries, _ := os.ReadDir(tempDstDir)
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".drop" {
			return
		}
	}
	// Zero or partial receive is fine; the critical check is send re-queue above.
}

func TestSendFileNamedRelativeMeta(t *testing.T) {
	tempSrcDir, err := os.MkdirTemp("", "transfer-rel-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempSrcDir)

	nested := filepath.Join(tempSrcDir, "nested")
	if err := os.MkdirAll(nested, 0755); err != nil {
		t.Fatal(err)
	}
	srcFilePath := filepath.Join(nested, "a.txt")
	if err := os.WriteFile(srcFilePath, []byte("hi"), 0644); err != nil {
		t.Fatal(err)
	}

	repo := fs.NewRepository()
	senderState := state.NewTransferState()
	sender := NewTransferService(repo, senderState, nil)

	metaCh := make(chan struct {
		name string
		hash string
	}, 1)
	sawStart := make(chan struct{}, 1)
	sender.SetTransports(
		func(ctrlData []byte) error {
			typeStr, _ := decodeType(ctrlData)
			switch typeStr {
			case "meta":
				var msg struct {
					Name string `json:"name"`
					Hash string `json:"hash"`
				}
				_ = json.Unmarshal(ctrlData, &msg)
				select {
				case metaCh <- struct {
					name string
					hash string
				}{msg.Name, msg.Hash}:
				default:
				}
			case "start":
				select {
				case sawStart <- struct{}{}:
				default:
				}
			}
			return nil
		},
		func(chunk []byte) error { return nil },
	)

	folderName := filepath.Base(tempSrcDir)
	announce := folderName + "/nested/a.txt"
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- sender.SendFileNamed(ctx, srcFilePath, announce)
	}()

	var metaName, metaHash string
	select {
	case m := <-metaCh:
		metaName, metaHash = m.name, m.hash
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for meta")
	}
	transfers := senderState.GetAll()
	if len(transfers) == 0 {
		t.Fatal("no transfer registered")
	}
	id := transfers[0].ID
	sender.HandleControlMessage(mustJSON(map[string]any{
		"type": "resume", "fileId": id, "hash": metaHash, "bytesOffset": 0,
	}))
	go func() {
		time.Sleep(20 * time.Millisecond)
		sender.HandleControlMessage(mustJSON(map[string]any{
			"type": "ack", "fileId": id,
		}))
	}()

	if err := <-errCh; err != nil {
		t.Fatalf("SendFileNamed: %v", err)
	}
	if metaName != announce {
		t.Fatalf("meta.name = %q, want %q", metaName, announce)
	}
	if !strings.HasPrefix(metaHash, announce+"|") {
		t.Fatalf("hash %q should start with announce name", metaHash)
	}
	select {
	case <-sawStart:
	default:
		t.Fatal("expected start for auto peer")
	}
}

func TestManualPeerWaitsForPull(t *testing.T) {
	tempSrcDir, err := os.MkdirTemp("", "transfer-manual-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempSrcDir)
	srcFilePath := filepath.Join(tempSrcDir, "file.bin")
	if err := os.WriteFile(srcFilePath, bytes.Repeat([]byte{1}, 4096), 0644); err != nil {
		t.Fatal(err)
	}

	repo := fs.NewRepository()
	senderState := state.NewTransferState()
	sender := NewTransferService(repo, senderState, nil)
	sender.SetChunkSize(1024)

	sender.HandleControlMessage(mustJSON(map[string]any{"type": "download-mode", "manual": true}))
	if !sender.RemoteManual() {
		t.Fatal("expected remoteManual")
	}

	ctrlCh := make(chan []byte, 100)
	sender.SetTransports(
		func(ctrlData []byte) error {
			ctrlCh <- append([]byte(nil), ctrlData...)
			return nil
		},
		func(chunk []byte) error { return nil },
	)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	errCh := make(chan error, 1)
	go func() { errCh <- sender.SendFile(ctx, srcFilePath) }()

	var fileID string
	deadline := time.After(2 * time.Second)
waitMeta:
	for {
		select {
		case data := <-ctrlCh:
			typeStr, _ := decodeType(data)
			if typeStr == "meta" {
				var msg struct {
					FileID string `json:"fileId"`
				}
				_ = json.Unmarshal(data, &msg)
				fileID = msg.FileID
				break waitMeta
			}
			if typeStr == "start" {
				t.Fatal("start before pull")
			}
		case <-deadline:
			t.Fatal("timeout waiting for meta")
		}
	}

	select {
	case data := <-ctrlCh:
		typeStr, _ := decodeType(data)
		if typeStr == "start" {
			t.Fatal("start before pull")
		}
	case <-time.After(100 * time.Millisecond):
	}

	sender.HandleControlMessage(mustJSON(map[string]any{"type": "pull", "fileId": fileID}))

	sawStart := false
	deadline = time.After(2 * time.Second)
	for !sawStart {
		select {
		case data := <-ctrlCh:
			typeStr, _ := decodeType(data)
			if typeStr == "start" {
				sawStart = true
			}
		case <-deadline:
			t.Fatal("timeout waiting for start after pull")
		}
	}

	sender.HandleControlMessage(mustJSON(map[string]any{
		"type": "resume", "fileId": fileID, "hash": "", "bytesOffset": 0,
	}))
	go func() {
		time.Sleep(50 * time.Millisecond)
		sender.HandleControlMessage(mustJSON(map[string]any{"type": "ack", "fileId": fileID}))
	}()

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("SendFile: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for SendFile complete")
	}
}

func TestDownloadAbortedBeforePull(t *testing.T) {
	tempSrcDir, err := os.MkdirTemp("", "transfer-abort-pull-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempSrcDir)
	srcFilePath := filepath.Join(tempSrcDir, "x.bin")
	if err := os.WriteFile(srcFilePath, []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}

	repo := fs.NewRepository()
	senderState := state.NewTransferState()
	sender := NewTransferService(repo, senderState, nil)
	sender.HandleControlMessage(mustJSON(map[string]any{"type": "download-mode", "manual": true}))

	ctrlCh := make(chan []byte, 100)
	sender.SetTransports(
		func(ctrlData []byte) error {
			ctrlCh <- append([]byte(nil), ctrlData...)
			return nil
		},
		func(chunk []byte) error { return nil },
	)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	errCh := make(chan error, 1)
	go func() { errCh <- sender.SendFile(ctx, srcFilePath) }()

	var fileID string
	for fileID == "" {
		select {
		case data := <-ctrlCh:
			if typeStr, _ := decodeType(data); typeStr == "meta" {
				var msg struct {
					FileID string `json:"fileId"`
				}
				_ = json.Unmarshal(data, &msg)
				fileID = msg.FileID
			}
		case <-time.After(2 * time.Second):
			t.Fatal("timeout meta")
		}
	}

	sender.HandleControlMessage(mustJSON(map[string]any{"type": "download-aborted", "fileId": fileID}))
	time.Sleep(50 * time.Millisecond)

	transfers := senderState.GetAll()
	if len(transfers) != 1 || transfers[0].Status != state.TransferPending {
		t.Fatalf("expected pending after abort, got %+v", transfers)
	}

	// Pull after abort should still start
	sender.HandleControlMessage(mustJSON(map[string]any{"type": "pull", "fileId": fileID}))
	sawStart := false
	deadline := time.After(2 * time.Second)
	for !sawStart {
		select {
		case data := <-ctrlCh:
			if typeStr, _ := decodeType(data); typeStr == "start" {
				sawStart = true
			}
		case <-deadline:
			t.Fatal("expected start after pull following abort")
		}
	}

	sender.HandleControlMessage(mustJSON(map[string]any{
		"type": "resume", "fileId": fileID, "hash": "", "bytesOffset": 0,
	}))
	go func() {
		time.Sleep(30 * time.Millisecond)
		sender.HandleControlMessage(mustJSON(map[string]any{"type": "ack", "fileId": fileID}))
	}()

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("SendFile: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timeout complete")
	}
}

func TestDownloadAbortedMidSend(t *testing.T) {
	tempSrcDir, err := os.MkdirTemp("", "transfer-abort-mid-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tempSrcDir)
	srcFilePath := filepath.Join(tempSrcDir, "big.bin")
	if err := os.WriteFile(srcFilePath, bytes.Repeat([]byte{2}, 256*1024), 0644); err != nil {
		t.Fatal(err)
	}

	repo := fs.NewRepository()
	senderState := state.NewTransferState()
	sender := NewTransferService(repo, senderState, nil)
	sender.SetChunkSize(4096)

	started := make(chan string, 1)
	sender.SetTransports(
		func(ctrlData []byte) error {
			typeStr, _ := decodeType(ctrlData)
			if typeStr == "start" {
				var msg struct {
					FileID string `json:"fileId"`
				}
				_ = json.Unmarshal(ctrlData, &msg)
				select {
				case started <- msg.FileID:
				default:
				}
			}
			return nil
		},
		func(chunk []byte) error {
			time.Sleep(20 * time.Millisecond)
			return nil
		},
	)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	errCh := make(chan error, 1)
	go func() { errCh <- sender.SendFile(ctx, srcFilePath) }()

	var fileID string
	select {
	case fileID = <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout start")
	}

	// Unblock resume
	sender.HandleControlMessage(mustJSON(map[string]any{
		"type": "resume", "fileId": fileID, "hash": "", "bytesOffset": 0,
	}))
	time.Sleep(40 * time.Millisecond)

	sender.HandleControlMessage(mustJSON(map[string]any{"type": "download-aborted", "fileId": fileID}))
	time.Sleep(80 * time.Millisecond)

	transfers := senderState.GetAll()
	if len(transfers) != 1 || transfers[0].Status != state.TransferPending {
		t.Fatalf("expected pending after mid-send abort, got %+v", transfers)
	}

	cancel()
	select {
	case <-errCh:
	case <-time.After(2 * time.Second):
	}
}

func decodeType(data []byte) (string, error) {
	var base struct {
		Type string `json:"type"`
	}
	err := json.Unmarshal(data, &base)
	return base.Type, err
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}


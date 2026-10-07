package services

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"dropcli/internal/adapters/fs"
	"dropcli/internal/state"
)

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

func TestAbortKeepPartialsPeerLostPTBR(t *testing.T) {
	tempDir := t.TempDir()
	repo := fs.NewRepository()
	ts := state.NewTransferState()
	settings := state.NewSettings()
	settings.SetDownloadDir(tempDir)
	settings.SetAutoDownload(false)

	ds := NewDownloadService(repo, ts, settings)
	if _, err := ds.HandleMeta(webrtcMeta("recv-1", "p.bin", 100, "h1")); err != nil {
		t.Fatal(err)
	}
	ds.AbortKeepPartials()

	tr, ok := ts.GetTransfer("recv-1")
	if !ok || tr.Status != state.TransferFailed {
		t.Fatalf("expected failed receive, got %+v", tr)
	}
	if tr.Error != "conexão perdida" {
		t.Fatalf("expected pt-BR peer-loss reason, got %q", tr.Error)
	}
}

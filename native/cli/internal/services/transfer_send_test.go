package services

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"dropcli/internal/adapters/fs"
	"dropcli/internal/state"
)

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

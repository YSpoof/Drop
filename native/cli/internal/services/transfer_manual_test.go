package services

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"dropcli/internal/adapters/fs"
	"dropcli/internal/state"
)

func TestManualAutoPullOnRetainedDrop(t *testing.T) {
	tempDir := t.TempDir()
	repo := fs.NewRepository()
	ts := state.NewTransferState()
	settings := state.NewSettings()
	settings.SetDownloadDir(tempDir)
	settings.SetAutoDownload(false)

	hash := "autoresumehash"
	fileSize := int64(1000)
	dropPath := filepath.Join(tempDir, repo.DropName(hash))
	if err := os.WriteFile(dropPath, bytes.Repeat([]byte{1}, 500), 0644); err != nil {
		t.Fatal(err)
	}

	ds := NewDownloadService(repo, ts, settings)
	xfer := NewTransferService(repo, ts, ds)

	pullCh := make(chan string, 4)
	xfer.SetTransports(
		func(data []byte) error {
			typ, err := decodeType(data)
			if err != nil {
				return nil
			}
			switch typ {
			case "pull":
				var msg struct {
					FileID string `json:"fileId"`
				}
				_ = json.Unmarshal(data, &msg)
				pullCh <- msg.FileID
			case "pull-batch":
				var msg struct {
					FileIDs []string `json:"fileIds"`
				}
				_ = json.Unmarshal(data, &msg)
				if len(msg.FileIDs) > 0 {
					pullCh <- msg.FileIDs[0]
				}
			}
			return nil
		},
		func([]byte) error { return nil },
	)

	xfer.HandleControlMessage(mustJSON(map[string]any{
		"type": "meta", "fileId": "f1", "name": "a.bin", "size": fileSize, "hash": hash, "mime": "application/octet-stream",
	}))

	select {
	case id := <-pullCh:
		if id != "f1" {
			t.Fatalf("pull fileId = %q, want f1", id)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected auto-pull for retained .drop")
	}

	tr, ok := ts.GetTransfer("f1")
	if !ok || tr.Hash != hash {
		t.Fatalf("expected receive hash %q on transfer, got %+v", hash, tr)
	}

	// Fresh announce without partial stays manual.
	xfer.HandleControlMessage(mustJSON(map[string]any{
		"type": "meta", "fileId": "f2", "name": "b.bin", "size": fileSize, "hash": "freshhash",
	}))
	select {
	case id := <-pullCh:
		t.Fatalf("unexpected pull for fresh announce: %s", id)
	case <-time.After(200 * time.Millisecond):
	}

	found := false
	for _, o := range ds.PendingOffers() {
		if o.FileID == "f2" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected f2 pending after fresh announce")
	}
}

func TestDismissedIdentityNoAutoPull(t *testing.T) {
	tempDir := t.TempDir()
	repo := fs.NewRepository()
	ts := state.NewTransferState()
	settings := state.NewSettings()
	settings.SetDownloadDir(tempDir)
	settings.SetAutoDownload(false)

	hash := "dismisshash"
	fileSize := int64(1000)
	dropPath := filepath.Join(tempDir, repo.DropName(hash))
	if err := os.WriteFile(dropPath, bytes.Repeat([]byte{1}, 400), 0644); err != nil {
		t.Fatal(err)
	}

	ds := NewDownloadService(repo, ts, settings)
	xfer := NewTransferService(repo, ts, ds)

	pullCh := make(chan string, 4)
	xfer.SetTransports(
		func(data []byte) error {
			typ, _ := decodeType(data)
			if typ == "pull" {
				var msg struct {
					FileID string `json:"fileId"`
				}
				_ = json.Unmarshal(data, &msg)
				pullCh <- msg.FileID
			}
			return nil
		},
		func([]byte) error { return nil },
	)

	offset, err := ds.HandleMeta(webrtcMeta("old-id", "x.bin", fileSize, hash))
	if err != nil {
		t.Fatal(err)
	}
	if offset != 400 {
		t.Fatalf("expected offset 400, got %d", offset)
	}
	if err := ds.DismissPending("old-id"); err != nil {
		t.Fatalf("DismissPending: %v", err)
	}
	if _, err := os.Stat(dropPath); !os.IsNotExist(err) {
		t.Fatal("expected .drop deleted after dismiss")
	}

	xfer.HandleControlMessage(mustJSON(map[string]any{
		"type": "meta", "fileId": "new-id", "name": "x.bin", "size": fileSize, "hash": hash,
	}))
	select {
	case id := <-pullCh:
		t.Fatalf("unexpected auto-pull after dismiss: %s", id)
	case <-time.After(200 * time.Millisecond):
	}

	found := false
	for _, o := range ds.PendingOffers() {
		if o.FileID == "new-id" {
			found = true
		}
	}
	if !found {
		t.Fatal("expected re-announce pending after dismiss")
	}
}

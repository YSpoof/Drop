package services

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"dropcli/internal/adapters/fs"
	"dropcli/internal/state"
	"dropcli/internal/webrtc"
)

func TestDownloadServiceStreamAndFlowControl(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "download-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	repo := fs.NewRepository()
	ts := state.NewTransferState()
	settings := state.NewSettings()
	settings.SetDownloadDir(tempDir)

	svc := NewDownloadService(repo, ts, settings)

	var emittedCredits []int64
	svc.SetEmitCredit(func(fileID string, bytes int64) error {
		emittedCredits = append(emittedCredits, bytes)
		return nil
	})

	var ackEmitted bool
	svc.SetEmitAck(func(fileID string) error {
		if fileID == "file-1" {
			ackEmitted = true
		}
		return nil
	})

	// Total size: 2.5 MiB = 2,621,440 bytes
	totalSize := int64(2621440)
	hash := webrtc.FileIdentity("testfile.bin", totalSize, 1700000000000)
	meta := webrtc.MetaMessage{
		Type:   webrtc.CtrlMeta,
		FileID: "file-1",
		Name:   "testfile.bin",
		Size:   totalSize,
		Hash:   hash,
	}

	offset, err := svc.HandleMeta(meta)
	if err != nil {
		t.Fatalf("HandleMeta failed: %v", err)
	}
	if offset != 0 {
		t.Fatalf("expected offset 0, got %d", offset)
	}

	start := webrtc.StartMessage{
		Type:      webrtc.CtrlStart,
		FileID:    "file-1",
		ChunkSize: 65536,
		Offset:    0,
	}
	if err := svc.HandleStart(start); err != nil {
		t.Fatalf("HandleStart failed: %v", err)
	}
	if svc.ResumeHash() != hash {
		t.Fatalf("expected resume hash %q, got %q", hash, svc.ResumeHash())
	}

	// Mid-transfer bytes live in .drop, not final name.
	if _, err := os.Stat(filepath.Join(tempDir, "testfile.bin")); !os.IsNotExist(err) {
		t.Fatal("expected final name absent during transfer")
	}
	if _, err := os.Stat(filepath.Join(tempDir, repo.DropName(hash))); err != nil {
		t.Fatalf("expected .drop during transfer: %v", err)
	}

	// Send chunks of 64 KiB
	chunk := bytes.Repeat([]byte{0xAB}, 65536)
	var written int64
	for written < totalSize {
		remaining := totalSize - written
		toSend := chunk
		if remaining < int64(len(chunk)) {
			toSend = chunk[:remaining]
		}
		if err := svc.HandleChunk(toSend); err != nil {
			t.Fatalf("HandleChunk failed: %v", err)
		}
		written += int64(len(toSend))
	}

	done := webrtc.DoneMessage{
		Type:   webrtc.CtrlDone,
		FileID: "file-1",
	}
	if err := svc.HandleDone(done); err != nil {
		t.Fatalf("HandleDone failed: %v", err)
	}

	if !ackEmitted {
		t.Fatal("expected ack to be emitted")
	}

	// Credits are absolute accepted offsets (Drop BytesWritten shape).
	if len(emittedCredits) == 0 {
		t.Fatal("expected credits to be emitted")
	}
	if emittedCredits[len(emittedCredits)-1] != totalSize {
		t.Fatalf("expected final credit %d, got %d (credits: %v)", totalSize, emittedCredits[len(emittedCredits)-1], emittedCredits)
	}
	for i := 1; i < len(emittedCredits); i++ {
		if emittedCredits[i] <= emittedCredits[i-1] {
			t.Fatalf("expected monotonic absolute credits, got %v", emittedCredits)
		}
	}

	// Verify file on disk
	savedPath := filepath.Join(tempDir, "testfile.bin")
	data, err := os.ReadFile(savedPath)
	if err != nil {
		t.Fatalf("failed to read saved file: %v", err)
	}
	if int64(len(data)) != totalSize {
		t.Fatalf("expected file length %d, got %d", totalSize, len(data))
	}
	if _, err := os.Stat(filepath.Join(tempDir, repo.DropName(hash))); !os.IsNotExist(err) {
		t.Fatal("expected .drop removed after finalize")
	}

	// Verify transfer status
	tr, ok := ts.GetTransfer("file-1")
	if !ok || tr.Status != state.TransferCompleted {
		t.Fatalf("unexpected transfer state: %+v", tr)
	}
}

func TestDownloadServiceResume(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "download-resume-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	repo := fs.NewRepository()
	ts := state.NewTransferState()
	settings := state.NewSettings()
	settings.SetDownloadDir(tempDir)

	hash := webrtc.FileIdentity("partial.bin", 1000, 1700000000000)
	dropPath := filepath.Join(tempDir, repo.DropName(hash))
	// Create pre-existing 500 byte partial .drop (chunk-aligned for chunkSize 500)
	if err := os.WriteFile(dropPath, bytes.Repeat([]byte{0x01}, 500), 0644); err != nil {
		t.Fatalf("failed to write partial drop: %v", err)
	}

	svc := NewDownloadService(repo, ts, settings)

	meta := webrtc.MetaMessage{
		Type:   webrtc.CtrlMeta,
		FileID: "file-resume",
		Name:   "partial.bin",
		Size:   1000,
		Hash:   hash,
	}

	resumeOffset, err := svc.HandleMeta(meta)
	if err != nil {
		t.Fatalf("HandleMeta failed: %v", err)
	}
	if resumeOffset != 500 {
		t.Fatalf("expected resume offset 500, got %d", resumeOffset)
	}

	start := webrtc.StartMessage{
		Type:      webrtc.CtrlStart,
		FileID:    "file-resume",
		ChunkSize: 500,
		Offset:    500,
	}
	if err := svc.HandleStart(start); err != nil {
		t.Fatalf("HandleStart failed: %v", err)
	}
	if svc.ResumeOffset() != 500 {
		t.Fatalf("expected aligned resume 500, got %d", svc.ResumeOffset())
	}
	if svc.ResumeHash() != hash {
		t.Fatalf("expected resume hash %q, got %q", hash, svc.ResumeHash())
	}

	if err := svc.HandleChunk(bytes.Repeat([]byte{0x02}, 500)); err != nil {
		t.Fatalf("HandleChunk failed: %v", err)
	}

	if err := svc.HandleDone(webrtc.DoneMessage{Type: webrtc.CtrlDone, FileID: "file-resume"}); err != nil {
		t.Fatalf("HandleDone failed: %v", err)
	}

	filePath := filepath.Join(tempDir, "partial.bin")
	content, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatalf("failed to read resumed file: %v", err)
	}
	if len(content) != 1000 {
		t.Fatalf("expected 1000 bytes, got %d", len(content))
	}
	if !bytes.Equal(content[:500], bytes.Repeat([]byte{0x01}, 500)) ||
		!bytes.Equal(content[500:], bytes.Repeat([]byte{0x02}, 500)) {
		t.Fatal("resumed file content mismatch")
	}
	if _, err := os.Stat(dropPath); !os.IsNotExist(err) {
		t.Fatal("expected .drop removed after finalize")
	}
}

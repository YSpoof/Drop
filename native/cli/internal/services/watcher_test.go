package services

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"dropcli/internal/adapters/fs"
	"dropcli/internal/adapters/watcher"
)

func TestFolderWatcherServiceDetectsNewFiles(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "watcher-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	w, err := watcher.New()
	if err != nil {
		t.Fatalf("failed to create watcher: %v", err)
	}

	repo := fs.NewRepository()
	svc := NewFolderWatcherService(w, repo)

	if err := svc.Watch(tmpDir); err != nil {
		t.Fatalf("failed to start watching: %v", err)
	}
	defer svc.Close()

	// Give the watcher a moment to set up
	time.Sleep(50 * time.Millisecond)

	// Create a file in the watched directory
	testFile := filepath.Join(tmpDir, "hello.txt")
	if err := os.WriteFile(testFile, []byte("hello world"), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	// Wait for the event to propagate
	select {
	case <-svc.Notify():
		// notified
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for watcher notification")
	}

	path, ok := svc.Dequeue()
	if !ok {
		t.Fatal("expected a queued file, got nothing")
	}
	if path != testFile {
		t.Fatalf("expected queued path %s, got %s", testFile, path)
	}

	// Queue should be empty now
	if svc.QueueLen() != 0 {
		t.Fatalf("expected empty queue, got %d items", svc.QueueLen())
	}
}

func TestFolderWatcherServiceDetectsModifiedFiles(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "watcher-mod-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	// Pre-create a file
	testFile := filepath.Join(tmpDir, "existing.txt")
	if err := os.WriteFile(testFile, []byte("initial"), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	w, err := watcher.New()
	if err != nil {
		t.Fatalf("failed to create watcher: %v", err)
	}

	repo := fs.NewRepository()
	svc := NewFolderWatcherService(w, repo)

	if err := svc.Watch(tmpDir); err != nil {
		t.Fatalf("failed to start watching: %v", err)
	}
	defer svc.Close()

	time.Sleep(50 * time.Millisecond)

	// Modify the existing file
	if err := os.WriteFile(testFile, []byte("modified content"), 0644); err != nil {
		t.Fatalf("failed to modify test file: %v", err)
	}

	select {
	case <-svc.Notify():
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for watcher notification on modification")
	}

	files := svc.DequeueAll()
	if len(files) == 0 {
		t.Fatal("expected queued files from modification, got none")
	}

	found := false
	for _, f := range files {
		if f == testFile {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected %s in dequeued files, got %v", testFile, files)
	}
}

func TestFolderWatcherServiceDetectsNestedCreate(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "watcher-nested-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	w, err := watcher.New()
	if err != nil {
		t.Fatalf("failed to create watcher: %v", err)
	}

	repo := fs.NewRepository()
	svc := NewFolderWatcherService(w, repo)

	if err := svc.Watch(tmpDir); err != nil {
		t.Fatalf("failed to start watching: %v", err)
	}
	defer svc.Close()

	time.Sleep(50 * time.Millisecond)

	nested := filepath.Join(tmpDir, "nested", "deep")
	if err := os.MkdirAll(nested, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	time.Sleep(100 * time.Millisecond)

	testFile := filepath.Join(nested, "file.bin")
	if err := os.WriteFile(testFile, []byte("nested"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	select {
	case <-svc.Notify():
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for nested file notification")
	}

	path, ok := svc.Dequeue()
	if !ok {
		t.Fatal("expected queued nested file")
	}
	if path != testFile {
		t.Fatalf("expected %s, got %s", testFile, path)
	}

	announce := svc.AnnounceName(path)
	wantPrefix := filepath.Base(tmpDir) + "/nested/deep/file.bin"
	if announce != wantPrefix {
		t.Fatalf("AnnounceName = %q, want %q", announce, wantPrefix)
	}
}

func TestFolderWatcherServiceIgnoresDirectories(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "watcher-dir-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	w, err := watcher.New()
	if err != nil {
		t.Fatalf("failed to create watcher: %v", err)
	}

	repo := fs.NewRepository()
	svc := NewFolderWatcherService(w, repo)

	if err := svc.Watch(tmpDir); err != nil {
		t.Fatalf("failed to start watching: %v", err)
	}
	defer svc.Close()

	time.Sleep(50 * time.Millisecond)

	// Create a subdirectory — should NOT be queued
	subDir := filepath.Join(tmpDir, "subdir")
	if err := os.Mkdir(subDir, 0755); err != nil {
		t.Fatalf("failed to create subdir: %v", err)
	}

	// Give events a moment to process
	time.Sleep(200 * time.Millisecond)

	if svc.QueueLen() != 0 {
		files := svc.DequeueAll()
		t.Fatalf("expected no queued files for directory creation, got: %v", files)
	}
}

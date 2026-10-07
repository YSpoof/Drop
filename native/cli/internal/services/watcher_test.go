package services

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"dropcli/internal/adapters/fs"
	"dropcli/internal/adapters/watcher"
)

func waitNotify(t *testing.T, svc *FolderWatcherService, timeout time.Duration) {
	t.Helper()
	select {
	case <-svc.Notify():
	case <-time.After(timeout):
		t.Fatal("timed out waiting for watcher notification")
	}
}

func drainQueue(svc *FolderWatcherService) []string {
	var out []string
	for {
		path, ok := svc.Dequeue()
		if !ok {
			return out
		}
		out = append(out, path)
	}
}

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

	time.Sleep(50 * time.Millisecond)

	testFile := filepath.Join(tmpDir, "hello.txt")
	if err := os.WriteFile(testFile, []byte("hello world"), 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	waitNotify(t, svc, 2*time.Second)

	path, ok := svc.Dequeue()
	if !ok {
		t.Fatal("expected a queued file, got nothing")
	}
	if path != testFile {
		t.Fatalf("expected queued path %s, got %s", testFile, path)
	}

	if _, ok := svc.Dequeue(); ok {
		t.Fatal("expected empty queue after single dequeue")
	}
}

func TestFolderWatcherServiceDetectsModifiedFiles(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "watcher-mod-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

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

	if err := os.WriteFile(testFile, []byte("modified content"), 0644); err != nil {
		t.Fatalf("failed to modify test file: %v", err)
	}

	waitNotify(t, svc, 2*time.Second)

	files := drainQueue(svc)
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

	waitNotify(t, svc, 3*time.Second)

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

	subDir := filepath.Join(tmpDir, "subdir")
	if err := os.Mkdir(subDir, 0755); err != nil {
		t.Fatalf("failed to create subdir: %v", err)
	}

	time.Sleep(200 * time.Millisecond)

	if files := drainQueue(svc); len(files) != 0 {
		t.Fatalf("expected no queued files for directory creation, got: %v", files)
	}
}

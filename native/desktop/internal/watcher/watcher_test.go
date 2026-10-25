package watcher

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestFolderWatcher(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "watcher-test-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	mgr := NewManager()
	defer mgr.StopAll()

	var mu sync.Mutex
	var events []Event

	err = mgr.Start("test-w1", tmpDir, func(ev Event) {
		mu.Lock()
		defer mu.Unlock()
		events = append(events, ev)
	})
	if err != nil {
		t.Fatalf("failed to start watcher: %v", err)
	}

	// 1. Create a file and verify "add" event
	filePath := filepath.Join(tmpDir, "sample.txt")
	content := []byte("Testing watcher event")
	if err := os.WriteFile(filePath, content, 0o644); err != nil {
		t.Fatal(err)
	}

	// Wait for settlement
	var foundAdd bool
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		for _, ev := range events {
			if ev.Type == "add" && ev.FilePath == filePath && ev.Size == int64(len(content)) {
				foundAdd = true
				break
			}
		}
		mu.Unlock()
		if foundAdd {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if !foundAdd {
		t.Fatalf("expected 'add' event for %s with size %d", filePath, len(content))
	}

	// 2. Remove the file and verify "unlink" event
	if err := os.Remove(filePath); err != nil {
		t.Fatal(err)
	}

	var foundUnlink bool
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		for _, ev := range events {
			if ev.Type == "unlink" && ev.FilePath == filePath {
				foundUnlink = true
				break
			}
		}
		mu.Unlock()
		if foundUnlink {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}

	if !foundUnlink {
		t.Fatalf("expected 'unlink' event for %s", filePath)
	}

	// 3. Stop watcher
	if err := mgr.Stop("test-w1"); err != nil {
		t.Fatalf("failed to stop watcher: %v", err)
	}
}

func TestStartReturnsWalkError(t *testing.T) {
	mgr := NewManager()
	err := mgr.Start("missing-root", filepath.Join(t.TempDir(), "missing"), func(Event) {})
	if err == nil {
		t.Fatal("expected Start to fail for a missing root directory")
	}
}

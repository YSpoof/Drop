package fswatch

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSourceDeliversRawEventsAndCloses(t *testing.T) {
	dir := t.TempDir()
	source, err := New()
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if err := source.Add(dir); err != nil {
		t.Fatalf("Add() error = %v", err)
	}

	path := filepath.Join(dir, "event.txt")
	if err := os.WriteFile(path, []byte("raw event"), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	deadline := time.After(3 * time.Second)
	for {
		select {
		case event, ok := <-source.Events():
			if !ok {
				t.Fatal("Events channel closed before delivering the file event")
			}
			if event.Name == path {
				if event.Op == 0 {
					t.Fatal("raw event has no operation")
				}
				goto eventReceived
			}
		case err, ok := <-source.Errors():
			if ok && err != nil {
				t.Fatalf("watcher error = %v", err)
			}
		case <-deadline:
			t.Fatalf("timed out waiting for raw event for %s", path)
		}
	}

eventReceived:
	if err := source.Remove(dir); err != nil {
		t.Fatalf("Remove() error = %v", err)
	}
	if err := source.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	for range source.Events() {
	}
	if _, ok := <-source.Events(); ok {
		t.Fatal("Events channel remained open after Close()")
	}
	if _, ok := <-source.Errors(); ok {
		t.Fatal("Errors channel remained open after Close()")
	}
}

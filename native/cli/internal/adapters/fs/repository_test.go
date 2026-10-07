package fs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFinalizeDropNestedPathCreatesParents(t *testing.T) {
	dest := t.TempDir()
	repo := NewRepository()
	hash := "abc123nested"
	dropPath := filepath.Join(dest, dropName(hash))
	if err := os.WriteFile(dropPath, []byte("payload"), 0o644); err != nil {
		t.Fatal(err)
	}

	chosen, err := repo.FinalizeDrop(dest, hash, "photos/nested/a.jpg")
	if err != nil {
		t.Fatalf("FinalizeDrop: %v", err)
	}
	if chosen != "photos/nested/a.jpg" {
		t.Fatalf("chosen = %q, want photos/nested/a.jpg", chosen)
	}

	final := filepath.Join(dest, filepath.FromSlash(chosen))
	data, err := os.ReadFile(final)
	if err != nil {
		t.Fatalf("read final: %v", err)
	}
	if string(data) != "payload" {
		t.Fatalf("payload = %q", data)
	}
	if _, err := os.Stat(filepath.Join(dest, "photos")); err != nil {
		t.Fatalf("photos dir missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "photos", "nested")); err != nil {
		t.Fatalf("photos/nested dir missing: %v", err)
	}
}

func TestSanitizeRelativePathRejectsTraversal(t *testing.T) {
	_, err := sanitizeRelativePath("photos/../evil.jpg")
	if err == nil {
		t.Fatal("expected error for .. segment")
	}
	if !strings.Contains(err.Error(), "invalid download path") {
		t.Fatalf("unexpected error: %v", err)
	}

	_, err = sanitizeRelativePath("../outside.jpg")
	if err == nil {
		t.Fatal("expected error for leading ..")
	}
}

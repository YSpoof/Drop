package services

import (
	"path/filepath"
	"testing"
)

func TestAnnounceNameForPathWatchRelative(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "data", "photos")
	nested := filepath.Join(root, "nested", "a.jpg")
	got := AnnounceNameForPath(nested, root)
	want := "photos/nested/a.jpg"
	if got != want {
		t.Fatalf("AnnounceNameForPath(%q, %q) = %q, want %q", nested, root, got, want)
	}
}

func TestAnnounceNameForPathSingleFileBasename(t *testing.T) {
	path := filepath.Join(string(filepath.Separator), "tmp", "report.pdf")
	got := AnnounceNameForPath(path, "")
	if got != "report.pdf" {
		t.Fatalf("got %q, want report.pdf", got)
	}
}

func TestAnnounceNameForPathProjectLayout(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "data", "project")
	file := filepath.Join(root, "src", "main.go")
	got := AnnounceNameForPath(file, root)
	want := "project/src/main.go"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

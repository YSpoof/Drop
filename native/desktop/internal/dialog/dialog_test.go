package dialog

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

type mockPicker struct {
	files  []string
	folder string
	err    error
}

func (m mockPicker) PickFiles(title, defaultPath string) ([]string, error) {
	return m.files, m.err
}

func (m mockPicker) PickFolder(title, defaultPath string) (string, error) {
	return m.folder, m.err
}

func TestDialogPicker(t *testing.T) {
	oldPicker := DefaultPicker
	defer func() { DefaultPicker = oldPicker }()

	mock := mockPicker{
		files:  []string{"/home/user/file1.png", "/home/user/file2.txt"},
		folder: "/home/user/Downloads",
	}
	DefaultPicker = mock

	files, err := PickFiles("Select Files", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !reflect.DeepEqual(files, mock.files) {
		t.Fatalf("expected files %v, got %v", mock.files, files)
	}

	folder, err := PickFolder("Select Folder", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if folder != mock.folder {
		t.Fatalf("expected folder %q, got %q", mock.folder, folder)
	}
}

func TestKDialogFallback(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("KDialog fallback is Linux-specific")
	}

	binDir := t.TempDir()
	kdialogPath := filepath.Join(binDir, "kdialog")
	script := `#!/bin/sh
case "$*" in
  *--getopenfilename*) printf '%s\n' '/tmp/one' '/tmp/two' ;;
  *) printf '%s\n' '/tmp/download folder' ;;
esac
`
	if err := os.WriteFile(kdialogPath, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir)

	picker := zenityPicker{}
	folder, err := picker.PickFolder("Choose folder", "")
	if err != nil {
		t.Fatalf("PickFolder returned an error: %v", err)
	}
	if folder != "/tmp/download folder" {
		t.Fatalf("expected folder path, got %q", folder)
	}

	files, err := picker.PickFiles("Choose files", "")
	if err != nil {
		t.Fatalf("PickFiles returned an error: %v", err)
	}
	wantFiles := []string{"/tmp/one", "/tmp/two"}
	if !reflect.DeepEqual(files, wantFiles) {
		t.Fatalf("expected files %v, got %v", wantFiles, files)
	}
}

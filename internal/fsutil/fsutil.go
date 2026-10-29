package fsutil

import (
	"fmt"
	"os"
	"path/filepath"
)

// HomeDir returns the user's home directory.
func HomeDir() (string, error) {
	return os.UserHomeDir()
}

// DownloadsDir returns the user's Downloads directory, creating it if needed.
func DownloadsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("user home dir: %w", err)
	}
	dir := filepath.Join(home, "Downloads")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return home, nil
	}
	return dir, nil
}

// MkdirAll creates a directory and all parents.
func MkdirAll(path string) error {
	return os.MkdirAll(path, 0o755)
}
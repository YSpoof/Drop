package bridge

import (
	"io"
	"os"
	"path/filepath"

	"drop/internal/fsutil"
)

// GetDownloadsPath returns the user's Downloads directory.
func GetDownloadsPath() (string, error) {
	return fsutil.DownloadsDir()
}

// Stat retrieves metadata for the given path. If the path does not exist, Exists will be false.
func Stat(path string) (*StatResult, error) {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &StatResult{Exists: false, Path: path}, nil
		}
		return nil, err
	}

	return &StatResult{
		Exists:     true,
		Path:       path,
		Size:       info.Size(),
		IsDir:      info.IsDir(),
		ModifiedAt: info.ModTime().UnixMilli(),
	}, nil
}

// ReadDir returns the contents of a directory with full metadata.
func ReadDir(dirPath string) ([]DirEntry, error) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, err
	}

	var results []DirEntry
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		entryType := "FILE"
		if entry.IsDir() {
			entryType = "DIRECTORY"
		}

		results = append(results, DirEntry{
			Entry:      entry.Name(),
			Path:       filepath.Join(dirPath, entry.Name()),
			Type:       entryType,
			Size:       info.Size(),
			ModifiedAt: info.ModTime().UnixMilli(),
		})
	}

	return results, nil
}

// Mkdir creates directory and all parents (equivalent to mkdir -p).
func Mkdir(path string) error {
	return os.MkdirAll(path, 0o755)
}

// Remove deletes the path (equivalent to rm -rf).
func Remove(path string) error {
	return os.RemoveAll(path)
}

// Move renames or moves a file or directory, falling back to copy+delete across devices.
func Move(from, to string) error {
	if err := os.Rename(from, to); err == nil {
		return nil
	}

	// Cross-device fallback: copy then remove
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()

	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		return err
	}

	dst, err := os.OpenFile(to, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return err
	}
	_ = src.Close()
	_ = dst.Close()

	return os.RemoveAll(from)
}

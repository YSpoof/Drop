package services

import (
	"path/filepath"
	"strings"
)

// AnnounceNameForPath returns a Drop-compatible meta.name for a local file.
// When watchRoot is set, the name is relative to the parent of the watch root
// so the first segment is the watched folder basename (e.g. photos/a.jpg).
// Paths use forward slashes. Single-file sends pass an empty watchRoot and get basename.
func AnnounceNameForPath(localPath, watchRoot string) string {
	if strings.TrimSpace(watchRoot) == "" {
		return filepath.Base(localPath)
	}

	absLocal, err := filepath.Abs(localPath)
	if err != nil {
		return filepath.Base(localPath)
	}
	absRoot, err := filepath.Abs(watchRoot)
	if err != nil {
		return filepath.Base(localPath)
	}

	parent := filepath.Dir(absRoot)
	rel, err := filepath.Rel(parent, absLocal)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return filepath.Base(localPath)
	}
	return filepath.ToSlash(rel)
}

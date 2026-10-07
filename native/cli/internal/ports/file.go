package ports

import (
	"io"
)

// FileInfo holds metadata for a file.
type FileInfo struct {
	Name     string
	Size     int64
	Mime     string
	Path     string
	MtimeMs  int64
}

// FileRepository defines disk file operations for reading and writing files.
type FileRepository interface {
	// OpenRead opens a file for reading from the beginning or a specific offset.
	OpenRead(path string, offset int64) (io.ReadCloser, int64, error)

	// CreateWrite opens or creates a file in destDir with given filename, optionally seeking/resuming at offset.
	CreateWrite(destDir string, filename string, offset int64) (io.WriteCloser, error)

	// GetFileSize returns the size of an existing file if it exists, or 0 and false if it doesn't.
	GetFileSize(destDir string, filename string) (int64, bool, error)

	// Stat returns metadata for a file path.
	Stat(path string) (FileInfo, error)

	// EnsureDir ensures that the destination directory exists.
	EnsureDir(dir string) error

	// DropName returns the sanitized on-disk basename for a Drop identity hash (includes .drop).
	DropName(hash string) string

	// GetDropResumeOffset returns the size of {hash}.drop when 0 < size < fileSize; otherwise 0.
	GetDropResumeOffset(destDir, hash string, fileSize int64) (int64, error)

	// CreateDropWrite opens {hash}.drop for writing at offset.
	// Offset 0 truncates; offset > 0 truncates the file to that length then seeks for append.
	CreateDropWrite(destDir, hash string, offset int64) (io.WriteCloser, error)

	// FinalizeDrop renames {hash}.drop to a unique finalName under destDir and returns the chosen name.
	FinalizeDrop(destDir, hash, finalName string) (string, error)

	// DropIncomplete removes one hash's .drop, or all *.drop files when hash is empty.
	DropIncomplete(destDir string, hash string) error
}

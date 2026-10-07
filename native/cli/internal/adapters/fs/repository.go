package fs

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"dropcli/internal/ports"
)

const dropSuffix = ".drop"

// Repository implements ports.FileRepository using standard local filesystem calls.
type Repository struct{}

// NewRepository creates a new local filesystem repository.
func NewRepository() *Repository {
	return &Repository{}
}

// OpenRead opens a file for reading, seeking to the specified offset if > 0.
func (r *Repository) OpenRead(path string, offset int64) (io.ReadCloser, int64, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to open file %s: %w", path, err)
	}

	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, 0, fmt.Errorf("failed to stat file %s: %w", path, err)
	}

	if offset > 0 {
		if _, err := file.Seek(offset, io.SeekStart); err != nil {
			file.Close()
			return nil, 0, fmt.Errorf("failed to seek file %s to offset %d: %w", path, offset, err)
		}
	}

	return file, info.Size(), nil
}

// CreateWrite opens or creates a file in destDir with filename, preparing for writing at offset.
func (r *Repository) CreateWrite(destDir string, filename string, offset int64) (io.WriteCloser, error) {
	if err := r.EnsureDir(destDir); err != nil {
		return nil, err
	}

	targetPath := filepath.Join(destDir, filename)
	var file *os.File
	var err error

	if offset > 0 {
		file, err = os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			return nil, fmt.Errorf("failed to open file for resume %s: %w", targetPath, err)
		}
		if _, err := file.Seek(offset, io.SeekStart); err != nil {
			file.Close()
			return nil, fmt.Errorf("failed to seek file to offset %d: %w", offset, err)
		}
	} else {
		file, err = os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err != nil {
			return nil, fmt.Errorf("failed to create file %s: %w", targetPath, err)
		}
	}

	return file, nil
}

// GetFileSize returns the size of an existing file in destDir, or 0 and false if it does not exist.
func (r *Repository) GetFileSize(destDir string, filename string) (int64, bool, error) {
	targetPath := filepath.Join(destDir, filename)
	info, err := os.Stat(targetPath)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, false, nil
		}
		return 0, false, err
	}
	return info.Size(), true, nil
}

// Stat returns metadata for a file path.
func (r *Repository) Stat(path string) (ports.FileInfo, error) {
	info, err := os.Stat(path)
	if err != nil {
		return ports.FileInfo{}, err
	}

	return ports.FileInfo{
		Name:    info.Name(),
		Size:    info.Size(),
		Path:    path,
		MtimeMs: info.ModTime().UnixMilli(),
	}, nil
}

// EnsureDir ensures that the destination directory exists.
func (r *Repository) EnsureDir(dir string) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}
	return nil
}

// DropName returns the sanitized on-disk basename for a Drop identity hash.
func (r *Repository) DropName(hash string) string {
	return dropName(hash)
}

// GetDropResumeOffset returns the size of {hash}.drop when 0 < size < fileSize; otherwise 0.
func (r *Repository) GetDropResumeOffset(destDir, hash string, fileSize int64) (int64, error) {
	if hash == "" {
		return 0, nil
	}
	size, exists, err := r.GetFileSize(destDir, dropName(hash))
	if err != nil {
		return 0, err
	}
	if exists && size > 0 && size < fileSize {
		return size, nil
	}
	return 0, nil
}

// CreateDropWrite opens {hash}.drop for writing at offset.
// Offset 0 truncates; offset > 0 truncates to that length then seeks for append.
func (r *Repository) CreateDropWrite(destDir, hash string, offset int64) (io.WriteCloser, error) {
	if err := r.EnsureDir(destDir); err != nil {
		return nil, err
	}
	if hash == "" {
		return nil, fmt.Errorf("empty drop hash")
	}

	targetPath := filepath.Join(destDir, dropName(hash))
	file, err := os.OpenFile(targetPath, os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("failed to open drop file %s: %w", targetPath, err)
	}

	if offset <= 0 {
		if err := file.Truncate(0); err != nil {
			file.Close()
			return nil, fmt.Errorf("failed to truncate drop file %s: %w", targetPath, err)
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			file.Close()
			return nil, fmt.Errorf("failed to seek drop file %s: %w", targetPath, err)
		}
		return file, nil
	}

	if err := file.Truncate(offset); err != nil {
		file.Close()
		return nil, fmt.Errorf("failed to truncate drop file %s to %d: %w", targetPath, offset, err)
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		file.Close()
		return nil, fmt.Errorf("failed to seek drop file %s to %d: %w", targetPath, offset, err)
	}
	return file, nil
}

// FinalizeDrop renames {hash}.drop to a unique finalName under destDir and returns the chosen name.
func (r *Repository) FinalizeDrop(destDir, hash, finalName string) (string, error) {
	if hash == "" {
		return "", fmt.Errorf("empty drop hash")
	}
	relative, err := sanitizeRelativePath(finalName)
	if err != nil {
		return "", err
	}
	if err := r.EnsureDir(destDir); err != nil {
		return "", err
	}

	dropPath := filepath.Join(destDir, dropName(hash))
	if _, err := os.Stat(dropPath); err != nil {
		return "", fmt.Errorf("drop file missing %s: %w", dropPath, err)
	}

	chosen, err := uniqueAvailableName(destDir, relative)
	if err != nil {
		return "", err
	}
	finalPath := filepath.Join(destDir, chosen)
	if parent := filepath.Dir(finalPath); parent != destDir {
		if err := r.EnsureDir(parent); err != nil {
			return "", err
		}
	}
	if err := os.Rename(dropPath, finalPath); err != nil {
		return "", fmt.Errorf("failed to finalize drop %s -> %s: %w", dropPath, finalPath, err)
	}
	return chosen, nil
}

// DropIncomplete removes one hash's .drop, or all *.drop files when hash is empty.
func (r *Repository) DropIncomplete(destDir string, hash string) error {
	if destDir == "" {
		return nil
	}
	if hash != "" {
		_ = os.Remove(filepath.Join(destDir, dropName(hash)))
		return nil
	}
	entries, err := os.ReadDir(destDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasSuffix(name, dropSuffix) {
			_ = os.Remove(filepath.Join(destDir, name))
		}
	}
	return nil
}

func dropName(id string) string {
	replacer := strings.NewReplacer(
		"<", "_", ">", "_", ":", "_", "\"", "_",
		"/", "_", "\\", "_", "|", "_", "?", "_", "*", "_",
	)
	return replacer.Replace(id) + dropSuffix
}

func sanitizeRelativePath(filename string) (string, error) {
	normalized := strings.ReplaceAll(filename, "\\", "/")
	normalized = strings.TrimLeft(normalized, "/")
	parts := strings.Split(normalized, "/")
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "" || part == "." {
			continue
		}
		if part == ".." {
			return "", fmt.Errorf("invalid download path")
		}
		clean = append(clean, part)
	}
	if len(clean) == 0 {
		return "download", nil
	}
	return strings.Join(clean, "/"), nil
}

func uniqueNameAt(name string, index int) string {
	if index == 0 {
		return name
	}
	dir, leaf := "", name
	if i := strings.LastIndexAny(name, "/\\"); i >= 0 {
		dir = name[:i+1]
		leaf = name[i+1:]
	}
	dot := strings.LastIndex(leaf, ".")
	base, ext := leaf, ""
	if dot > 0 {
		base = leaf[:dot]
		ext = leaf[dot:]
	}
	return fmt.Sprintf("%s%s (%d)%s", dir, base, index, ext)
}

func uniqueAvailableName(destDir, name string) (string, error) {
	for index := 0; ; index++ {
		candidate := uniqueNameAt(name, index)
		_, err := os.Stat(filepath.Join(destDir, candidate))
		if os.IsNotExist(err) {
			return candidate, nil
		}
		if err != nil {
			return "", err
		}
	}
}

package drop

import (
	"embed"
	"io/fs"
)

//go:embed all:frontend/build
var frontendAssets embed.FS

//go:embed all:downloads
var downloadAssets embed.FS

// FrontendFS returns the embedded frontend build filesystem.
func FrontendFS() (fs.FS, error) {
	return fs.Sub(frontendAssets, "frontend/build")
}

// DownloadsFS returns the embedded downloads filesystem.
func DownloadsFS() (fs.FS, error) {
	return fs.Sub(downloadAssets, "downloads")
}

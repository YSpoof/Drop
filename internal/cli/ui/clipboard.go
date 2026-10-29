package ui

import "drop/internal/cli/libs/clip"

// CopyToClipboard writes text to the system clipboard.
func CopyToClipboard(text string) error {
	return clip.Write(text)
}

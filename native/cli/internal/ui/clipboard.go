package ui

import "dropcli/libs/clip"

// CopyToClipboard writes text to the system clipboard.
func CopyToClipboard(text string) error {
	return clip.Write(text)
}

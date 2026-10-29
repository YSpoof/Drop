//go:build linux || windows

// Package clip writes text to the system clipboard (Linux and Windows).
package clip

// Write puts text on the system clipboard.
// Linux tries wl-copy, then xclip, then xsel.
// Windows uses clip.exe via stdin.
func Write(text string) error {
	return write(text)
}

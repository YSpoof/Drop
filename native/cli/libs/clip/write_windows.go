//go:build windows

package clip

import (
	"fmt"
	"os/exec"
	"strings"
)

func write(text string) error {
	path, err := exec.LookPath("clip")
	if err != nil {
		path, err = exec.LookPath("clip.exe")
		if err != nil {
			return fmt.Errorf("clipboard: clip.exe not found: %w", err)
		}
	}
	cmd := exec.Command(path)
	cmd.Stdin = strings.NewReader(text)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("clipboard: clip.exe: %w", err)
	}
	return nil
}

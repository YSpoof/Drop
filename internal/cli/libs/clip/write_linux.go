//go:build linux

package clip

import (
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// write tries Wayland then X11 clipboard tools. Needs at least one installed.
func write(text string) error {
	var errs []string

	if path, err := exec.LookPath("wl-copy"); err == nil {
		cmd := exec.Command(path)
		cmd.Stdin = strings.NewReader(text)
		if err := cmd.Run(); err == nil {
			return nil
		} else {
			errs = append(errs, fmt.Sprintf("wl-copy: %v", err))
		}
	}

	if path, err := exec.LookPath("xclip"); err == nil {
		cmd := exec.Command(path, "-selection", "clipboard")
		cmd.Stdin = strings.NewReader(text)
		if err := cmd.Run(); err == nil {
			return nil
		} else {
			errs = append(errs, fmt.Sprintf("xclip: %v", err))
		}
	}

	if path, err := exec.LookPath("xsel"); err == nil {
		cmd := exec.Command(path, "--clipboard", "--input")
		cmd.Stdin = strings.NewReader(text)
		if err := cmd.Run(); err == nil {
			return nil
		} else {
			errs = append(errs, fmt.Sprintf("xsel: %v", err))
		}
	}

	if len(errs) == 0 {
		return errors.New("clipboard: no wl-copy, xclip, or xsel found")
	}
	return fmt.Errorf("clipboard: %s", strings.Join(errs, "; "))
}

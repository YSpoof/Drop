package dialog

import (
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"

	"github.com/ncruces/zenity"
)

// DialogPicker abstracts native file/folder picker dialogs for testing.
type DialogPicker interface {
	PickFiles(title, defaultPath string) ([]string, error)
	PickFolder(title, defaultPath string) (string, error)
}

type zenityPicker struct{}

func (z zenityPicker) PickFiles(title, defaultPath string) ([]string, error) {
	if path, ok := kdialogPath(); ok {
		args := []string{"--multiple", "--separate-output"}
		if title != "" {
			args = append(args, "--title", title)
		}
		args = append(args, "--getopenfilename")
		if defaultPath != "" {
			args = append(args, defaultPath)
		}

		selected, err := runKDialog(path, args...)
		if err != nil {
			return nil, err
		}
		if selected == "" {
			return []string{}, nil
		}

		paths := strings.Split(selected, "\n")
		for i := range paths {
			paths[i] = strings.TrimSuffix(paths[i], "\r")
		}
		return paths, nil
	}

	var opts []zenity.Option
	if title != "" {
		opts = append(opts, zenity.Title(title))
	}
	if defaultPath != "" {
		opts = append(opts, zenity.Filename(defaultPath))
	}

	paths, err := zenity.SelectFileMultiple(opts...)
	if err != nil {
		if errors.Is(err, zenity.ErrCanceled) {
			return []string{}, nil
		}
		return nil, err
	}
	return paths, nil
}

func (z zenityPicker) PickFolder(title, defaultPath string) (string, error) {
	if path, ok := kdialogPath(); ok {
		args := make([]string, 0, 4)
		if title != "" {
			args = append(args, "--title", title)
		}
		args = append(args, "--getexistingdirectory")
		if defaultPath != "" {
			args = append(args, defaultPath)
		}
		return runKDialog(path, args...)
	}

	opts := []zenity.Option{zenity.Directory()}
	if title != "" {
		opts = append(opts, zenity.Title(title))
	}
	if defaultPath != "" {
		opts = append(opts, zenity.Filename(defaultPath))
	}

	path, err := zenity.SelectFile(opts...)
	if err != nil {
		if errors.Is(err, zenity.ErrCanceled) {
			return "", nil
		}
		return "", err
	}
	return path, nil
}

func kdialogPath() (string, bool) {
	if runtime.GOOS != "linux" {
		return "", false
	}
	if _, err := exec.LookPath("zenity"); err == nil {
		return "", false
	}

	path, err := exec.LookPath("kdialog")
	return path, err == nil
}

func runKDialog(path string, args ...string) (string, error) {
	output, err := exec.Command(path, args...).Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) && exitErr.ExitCode() == 1 {
			return "", nil
		}
		return "", fmt.Errorf("run kdialog: %w", err)
	}
	return strings.TrimRight(string(output), "\r\n"), nil
}

// DefaultPicker uses Zenity, with KDialog as a Linux fallback.
var DefaultPicker DialogPicker = zenityPicker{}

// PickFiles opens a native multi-file selection dialog.
func PickFiles(title, defaultPath string) ([]string, error) {
	return DefaultPicker.PickFiles(title, defaultPath)
}

// PickFolder opens a native folder selection dialog.
func PickFolder(title, defaultPath string) (string, error) {
	return DefaultPicker.PickFolder(title, defaultPath)
}

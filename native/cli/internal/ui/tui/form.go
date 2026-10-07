package tui

import (
	"errors"
	"fmt"
	"os"
	"regexp"

	"dropcli/internal/state"
	"dropcli/internal/ui/text"

	"github.com/charmbracelet/huh"
)

// pinPattern matches exactly 4 digits.
var pinPattern = regexp.MustCompile(`^\d{4}$`)

// SessionMode represents the user's chosen role.
type SessionMode string

const (
	ModeHost SessionMode = "host"
	ModeJoin SessionMode = "join"
)

// FormResult contains the user's selections from the interactive form.
type FormResult struct {
	Mode        SessionMode
	PIN         string
	DeviceName  string
	DownloadDir string
}

// RunForm presents the interactive TUI form and returns the user's choices.
func RunForm(defaultDeviceName, defaultDownloadDir string) (*FormResult, error) {
	result := &FormResult{
		DeviceName:  defaultDeviceName,
		DownloadDir: defaultDownloadDir,
	}

	var modeStr string

	// Step 1: Host vs Join selection (labels match web/desktop exactly)
	modeForm := huh.NewForm(
		huh.NewGroup(
			huh.NewSelect[string]().
				Title(text.ModePrompt).
				Options(
					huh.NewOption(text.HostSession, string(ModeHost)),
					huh.NewOption(text.JoinSession, string(ModeJoin)),
				).
				Value(&modeStr),
		),
	)

	if err := modeForm.Run(); err != nil {
		return nil, fmt.Errorf(text.ErrModeSelection, err)
	}

	result.Mode = SessionMode(modeStr)

	// Step 2: If joining, prompt for PIN
	if result.Mode == ModeJoin {
		pinForm := huh.NewForm(
			huh.NewGroup(
				huh.NewInput().
					Title(text.EnterPIN).
					Value(&result.PIN).
					Validate(ValidatePIN),
			),
		)

		if err := pinForm.Run(); err != nil {
			return nil, fmt.Errorf(text.ErrPINEntry, err)
		}
	}

	// Step 3: Device name and download directory
	settingsForm := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title(text.DisplayName).
				Value(&result.DeviceName),
			huh.NewInput().
				Title(text.DownloadDir).
				Value(&result.DownloadDir).
				Validate(validateDir),
		),
	)

	if err := settingsForm.Run(); err != nil {
		return nil, fmt.Errorf(text.ErrSettingsEntry, err)
	}

	return result, nil
}

// ValidatePIN checks that the input is exactly 4 digits.
func ValidatePIN(input string) error {
	if !pinPattern.MatchString(input) {
		return errors.New(text.ErrPINDigits)
	}
	return nil
}

// validateDir checks that the directory path is non-empty and is a valid existing or creatable path.
func validateDir(input string) error {
	if input == "" {
		return errors.New(text.ErrDownloadDirEmpty)
	}
	info, err := os.Stat(input)
	if err == nil && !info.IsDir() {
		return errors.New(text.ErrPathNotDir)
	}
	// Non-existent directories are ok — they will be created at runtime.
	return nil
}

// RunConfigMenu presents an interactive form to view and modify settings (*state.Settings)
// and offers a confirmation prompt to reset transfer statistics.
func RunConfigMenu(settings *state.Settings) error {
	if settings == nil {
		return errors.New(text.ErrSettingsNil)
	}

	deviceName := settings.GetDeviceName()
	downloadDir := settings.GetDownloadDir()
	var resetStats bool

	form := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().
				Title(text.DisplayName).
				Value(&deviceName),
			huh.NewInput().
				Title(text.DownloadDir).
				Value(&downloadDir).
				Validate(validateDir),
			huh.NewConfirm().
				Title(text.ResetTransferStats).
				Value(&resetStats),
		),
	)

	if err := form.Run(); err != nil {
		return fmt.Errorf(text.ErrConfigMenu, err)
	}

	settings.SetDeviceName(deviceName)
	settings.SetDownloadDir(downloadDir)

	if resetStats {
		if err := settings.ResetStats(); err != nil {
			return fmt.Errorf(text.ErrResetStats, err)
		}
	}

	return nil
}

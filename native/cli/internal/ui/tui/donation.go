package tui

import (
	"errors"
	"fmt"

	"dropcli/internal/state"
	"dropcli/internal/ui"
	"dropcli/internal/ui/text"

	"github.com/charmbracelet/huh"
)

const (
	donationActionCopy  = "copy"
	donationActionClose = "close"
)

// RunDonationReminder shows the PIX donation prompt.
// Copy keeps the prompt open; Fechar dismisses and clears the due reminder.
func RunDonationReminder(settings *state.Settings) error {
	if settings == nil {
		return errors.New(text.ErrSettingsNil)
	}

	feedback := ""
	for {
		description := text.DonationBody + "\n\n" +
			text.DonationPIXHint + "\n" +
			state.DonationPixKey
		if feedback != "" {
			description += "\n\n" + feedback
		}

		var action string
		form := huh.NewForm(
			huh.NewGroup(
				huh.NewNote().
					Title(text.DonationTitle).
					Description(description),
				huh.NewSelect[string]().
					Options(
						huh.NewOption(text.DonationCopyPIX, donationActionCopy),
						huh.NewOption(text.DonationClose, donationActionClose),
					).
					Value(&action),
			),
		)

		if err := form.Run(); err != nil {
			return fmt.Errorf(text.ErrDonationReminder, err)
		}

		switch action {
		case donationActionCopy:
			if err := ui.CopyToClipboard(state.DonationPixKey); err != nil {
				feedback = fmt.Sprintf(text.CopyPIXFailed, err)
				continue
			}
			feedback = text.PIXCopied
		case donationActionClose:
			if err := settings.DismissDonationReminder(); err != nil {
				return fmt.Errorf(text.ErrDismissDonation, err)
			}
			return nil
		default:
			return nil
		}
	}
}

// CopyDonationPIX copies the project PIX key and returns a user-facing status line.
// Does not dismiss a due donation reminder.
func CopyDonationPIX() (status string, ok bool) {
	if err := ui.CopyToClipboard(state.DonationPixKey); err != nil {
		return fmt.Sprintf(text.CopyPIXFailed, err), false
	}
	return text.PIXCopied, true
}

package tui

import (
	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

// Shared palette tokens for inbox, confirm, forms, and donation chrome.
var (
	colorTitle  = lipgloss.Color("12") // bright blue
	colorAccent = lipgloss.Color("14") // cyan
	colorDim    = lipgloss.Color("8")  // gray
	colorOK     = lipgloss.Color("2")  // green
	colorWarn   = lipgloss.Color("11") // yellow
	colorErr    = lipgloss.Color("1")  // red
	colorPINFg  = lipgloss.Color("10") // bright green
	colorPINBg  = lipgloss.Color("0")  // black
	colorBorder = lipgloss.Color("8")
)

// Shared styles used across interactive surfaces.
var (
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(colorTitle)

	accentStyle = lipgloss.NewStyle().
			Foreground(colorAccent)

	dimStyle = lipgloss.NewStyle().
			Foreground(colorDim)

	okStyle = lipgloss.NewStyle().
			Foreground(colorOK)

	warnStyle = lipgloss.NewStyle().
			Foreground(colorWarn).
			Bold(true)

	errStyle = lipgloss.NewStyle().
			Foreground(colorErr)

	panelBorderStyle = lipgloss.NewStyle().
				Foreground(colorBorder)

	pinStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(colorPINFg).
			Background(colorPINBg).
			Padding(0, 1)

	statusStyle = accentStyle

	activeFileStyle = warnStyle

	completedFileStyle = okStyle

	failedFileStyle = errStyle

	rateStyle = dimStyle

	dividerStyle = panelBorderStyle

	confirmTitleStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("15"))
	confirmHintStyle  = dimStyle
)

// SharedHuhTheme returns a huh theme aligned with the inbox palette.
func SharedHuhTheme() *huh.Theme {
	t := huh.ThemeCharm()
	t.Focused.Title = t.Focused.Title.Foreground(colorTitle).Bold(true)
	t.Focused.NoteTitle = t.Focused.NoteTitle.Foreground(colorTitle).Bold(true).MarginBottom(1)
	t.Focused.Description = t.Focused.Description.Foreground(colorDim)
	t.Focused.ErrorIndicator = t.Focused.ErrorIndicator.Foreground(colorErr)
	t.Focused.ErrorMessage = t.Focused.ErrorMessage.Foreground(colorErr)
	t.Focused.SelectSelector = t.Focused.SelectSelector.Foreground(colorAccent)
	t.Focused.SelectedOption = t.Focused.SelectedOption.Foreground(colorOK)
	t.Focused.TextInput.Cursor = t.Focused.TextInput.Cursor.Foreground(colorOK)
	t.Focused.TextInput.Prompt = t.Focused.TextInput.Prompt.Foreground(colorAccent)
	t.Blurred = t.Focused
	t.Blurred.Base = t.Focused.Base.BorderStyle(lipgloss.HiddenBorder())
	t.Blurred.Card = t.Blurred.Base
	t.Blurred.NextIndicator = lipgloss.NewStyle()
	t.Blurred.PrevIndicator = lipgloss.NewStyle()
	t.Group.Title = t.Focused.Title
	t.Group.Description = t.Focused.Description
	return t
}

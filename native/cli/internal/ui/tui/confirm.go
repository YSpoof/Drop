package tui

import (
	"os"
	"sync/atomic"

	"dropcli/internal/ui/text"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"golang.org/x/term"
)

// ConfirmResult is the outcome of the confirm-to-exit overlay.
type ConfirmResult int

const (
	// ConfirmDismiss means the user pressed ESC and wants to continue.
	ConfirmDismiss ConfirmResult = iota
	// ConfirmExit means the user pressed Ctrl+C again and wants to leave.
	ConfirmExit
)

// showingConfirm is true while RunConfirmExit (or an embedded overlay) owns the interrupt UX.
var showingConfirm atomic.Bool

// ConfirmShowing reports whether a confirm overlay is currently active.
func ConfirmShowing() bool {
	return showingConfirm.Load()
}

func setConfirmShowing(v bool) {
	showingConfirm.Store(v)
}

// ConfirmModel is a full-viewport alt-screen confirm-to-exit overlay.
//
// Lifecycle:
//   - First Ctrl+C on an inactive model → show overlay (does not quit).
//   - Second Ctrl+C while visible → ConfirmExit.
//   - ESC while visible → ConfirmDismiss.
type ConfirmModel struct {
	width   int
	height  int
	visible bool
	done    bool
	result  ConfirmResult
}

// NewConfirmModel returns an inactive confirm model (first Ctrl+C will show it).
func NewConfirmModel() ConfirmModel {
	return ConfirmModel{}
}

// NewConfirmOverlay returns a model already showing the overlay (first interrupt already consumed).
func NewConfirmOverlay() ConfirmModel {
	return ConfirmModel{visible: true}
}

// Init is a no-op; callers that run a standalone program should use tea.WithAltScreen.
func (m ConfirmModel) Init() tea.Cmd {
	return nil
}

// Update handles window size and confirm keys.
func (m ConfirmModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			if !m.visible {
				m.visible = true
				return m, nil
			}
			m.result = ConfirmExit
			m.done = true
			return m, tea.Quit
		case "esc":
			if !m.visible {
				break
			}
			m.result = ConfirmDismiss
			m.done = true
			return m, tea.Quit
		}
	}
	return m, nil
}

// View renders the centered pt-BR confirm copy, or empty when done/hidden.
func (m ConfirmModel) View() string {
	if m.done || !m.visible {
		return ""
	}
	return ConfirmOverlayView(m.width, m.height)
}

// Result returns the outcome after the model has finished.
func (m ConfirmModel) Result() ConfirmResult {
	return m.result
}

// Visible reports whether the overlay is showing.
func (m ConfirmModel) Visible() bool {
	return m.visible && !m.done
}

// Done reports whether the model has reached a terminal outcome.
func (m ConfirmModel) Done() bool {
	return m.done
}

var confirmTitleStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("15"))
var confirmHintStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("8"))

// ConfirmOverlayView renders the full-viewport confirm copy centered in the given size.
func ConfirmOverlayView(width, height int) string {
	title := confirmTitleStyle.Render(text.ConfirmExitTitle)
	hintExit := confirmHintStyle.Render(text.ConfirmExitHint)
	hintCont := confirmHintStyle.Render(text.ConfirmContinueHint)
	body := lipgloss.JoinVertical(lipgloss.Center, title, "", hintExit, hintCont)

	if width <= 0 {
		width = 80
	}
	if height <= 0 {
		height = 24
	}
	return lipgloss.Place(width, height, lipgloss.Center, lipgloss.Center, body)
}

// RunConfirmExit shows the alt-screen confirm overlay on a TTY.
// Returns confirmed=true when the user presses Ctrl+C again; false on ESC.
// Non-TTY: returns confirmed=true immediately (caller should cancel).
func RunConfirmExit() (confirmed bool, err error) {
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return true, nil
	}
	setConfirmShowing(true)
	defer setConfirmShowing(false)

	m := NewConfirmOverlay()
	p := tea.NewProgram(m, tea.WithAltScreen(), tea.WithInput(os.Stdin), tea.WithOutput(os.Stderr))
	final, err := p.Run()
	if err != nil {
		return false, err
	}
	cm, ok := final.(ConfirmModel)
	if !ok {
		return false, nil
	}
	return cm.Result() == ConfirmExit, nil
}

package tui

import (
	"strings"
	"testing"

	"dropcli/internal/ui/text"

	tea "github.com/charmbracelet/bubbletea"
)

func TestConfirmModelFirstCtrlCStaysOpen(t *testing.T) {
	m := ConfirmModel{}
	next, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	cm := next.(ConfirmModel)
	if cm.Done() {
		t.Fatal("first Ctrl+C must not finish the model")
	}
	if !cm.Visible() {
		t.Fatal("first Ctrl+C must show overlay")
	}
	_ = cmd
}

func TestConfirmModelSecondCtrlCConfirms(t *testing.T) {
	m := NewConfirmOverlay()
	next, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	cm := next.(ConfirmModel)
	if !cm.Done() {
		t.Fatal("second Ctrl+C must finish")
	}
	if cm.Result() != ConfirmExit {
		t.Fatalf("want ConfirmExit, got %v", cm.Result())
	}
	if cmd == nil {
		t.Fatal("expected Quit cmd")
	}
}

func TestConfirmModelEscDismisses(t *testing.T) {
	m := NewConfirmOverlay()
	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	cm := next.(ConfirmModel)
	if !cm.Done() {
		t.Fatal("ESC must finish")
	}
	if cm.Result() != ConfirmDismiss {
		t.Fatalf("want ConfirmDismiss, got %v", cm.Result())
	}
}

func TestConfirmModelViewContainsPtBR(t *testing.T) {
	m := NewConfirmOverlay()
	m.width, m.height = 80, 24
	view := m.View()
	for _, want := range []string{text.ConfirmExitTitle, text.ConfirmExitHint, text.ConfirmContinueHint} {
		if !strings.Contains(view, want) {
			t.Fatalf("View missing %q; got:\n%s", want, view)
		}
	}
}

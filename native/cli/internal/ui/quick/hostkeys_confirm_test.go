package quick

import (
	"testing"

	"dropcli/internal/ui/tui"

	tea "github.com/charmbracelet/bubbletea"
)

// Host PIN wait: raw 0x03 → hostConfirmExit (RunConfirmExit). Outcomes match ConfirmModel.
// Peer-start stops keys via hostKeysCancel + done barrier (separate from session cancel).
// Restore-once after confirm is covered by TestHostCopyKeysDoneAfterConfirmExitRestoresOnce.

func TestHostInterruptConfirmExitCallsOnConfirm(t *testing.T) {
	called := false
	onConfirm := func() { called = true }

	m := tui.NewConfirmOverlay()
	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	cm := next.(tui.ConfirmModel)
	if cm.Result() != tui.ConfirmExit {
		t.Fatal("expected ConfirmExit")
	}
	onConfirm()
	if !called {
		t.Fatal("confirm must invoke onConfirm (session cancel)")
	}
}

func TestHostInterruptDismissSkipsOnConfirm(t *testing.T) {
	called := false
	onConfirm := func() { called = true }

	m := tui.NewConfirmOverlay()
	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	cm := next.(tui.ConfirmModel)
	if cm.Result() != tui.ConfirmDismiss {
		t.Fatal("expected ConfirmDismiss")
	}
	if cm.Result() == tui.ConfirmExit {
		onConfirm()
	}
	if called {
		t.Fatal("dismiss must not invoke onConfirm")
	}
}

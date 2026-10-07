package tui

import (
	"strings"
	"testing"

	"dropcli/internal/state"
	"dropcli/internal/ui/text"

	tea "github.com/charmbracelet/bubbletea"
)

func TestInboxFirstCtrlCShowsConfirm(t *testing.T) {
	t.Cleanup(func() { setConfirmShowing(false) })

	peer := state.NewPeerState()
	ts := state.NewTransferState()
	m := NewInboxModel(peer, ts, stubInboxActions{}, "peer-1", "wss://example/ws")

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	im := next.(InboxModel)
	if !im.confirming {
		t.Fatal("first ctrl+c must open confirm overlay")
	}
	if im.quitting {
		t.Fatal("first ctrl+c must not quit")
	}
	view := im.View()
	if !strings.Contains(view, text.ConfirmExitHint) {
		t.Fatalf("view should show confirm copy, got:\n%s", view)
	}
}

func TestInboxEscClearsConfirm(t *testing.T) {
	t.Cleanup(func() { setConfirmShowing(false) })

	peer := state.NewPeerState()
	ts := state.NewTransferState()
	m := NewInboxModel(peer, ts, stubInboxActions{}, "peer-1", "wss://example/ws")
	m.confirming = true
	setConfirmShowing(true)

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	im := next.(InboxModel)
	if im.confirming {
		t.Fatal("ESC must clear confirm")
	}
	if im.quitting {
		t.Fatal("ESC must not quit")
	}
}

func TestInboxSecondCtrlCQuits(t *testing.T) {
	t.Cleanup(func() { setConfirmShowing(false) })

	peer := state.NewPeerState()
	ts := state.NewTransferState()
	m := NewInboxModel(peer, ts, stubInboxActions{}, "peer-1", "wss://example/ws")
	m.confirming = true
	setConfirmShowing(true)

	next, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	im := next.(InboxModel)
	if !im.quitting {
		t.Fatal("second ctrl+c must quit")
	}
	if cmd == nil {
		t.Fatal("expected Quit cmd")
	}
}

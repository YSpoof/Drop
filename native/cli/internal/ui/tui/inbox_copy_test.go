package tui

import (
	"strings"
	"testing"

	"dropcli/internal/services"
	"dropcli/internal/state"
	"dropcli/internal/ui/text"

	tea "github.com/charmbracelet/bubbletea"
)

type stubInboxActions struct{}

func (stubInboxActions) SendPullBatch([]string) error           { return nil }
func (stubInboxActions) DismissPendingBatch([]string) error     { return nil }
func (stubInboxActions) PendingOffers() []services.PendingOffer { return nil }

func TestInboxCopyPINKey(t *testing.T) {
	peer := state.NewPeerState()
	peer.SetRole(state.RoleHost)
	peer.SetPIN("4242")
	ts := state.NewTransferState()
	m := NewInboxModel(peer, ts, stubInboxActions{}, "peer-1", "wss://drop.lzart.com.br/ws")

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}})
	im, ok := next.(InboxModel)
	if !ok {
		t.Fatalf("expected InboxModel, got %T", next)
	}
	if im.status != text.PINCopied && !strings.Contains(im.status, "Falha ao copiar PIN") {
		t.Fatalf("unexpected status after c: %q", im.status)
	}
}

func TestInboxCopyShareLinkKey(t *testing.T) {
	peer := state.NewPeerState()
	peer.SetRole(state.RoleHost)
	peer.SetPIN("4242")
	ts := state.NewTransferState()
	m := NewInboxModel(peer, ts, stubInboxActions{}, "peer-1", "wss://drop.lzart.com.br/ws")

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'C'}})
	im, ok := next.(InboxModel)
	if !ok {
		t.Fatalf("expected InboxModel, got %T", next)
	}
	if im.status != text.ShareLinkCopied && !strings.Contains(im.status, "Falha ao copiar link") {
		t.Fatalf("unexpected status after C: %q", im.status)
	}
}

func TestInboxCopyKeysNoopWithoutPIN(t *testing.T) {
	peer := state.NewPeerState()
	ts := state.NewTransferState()
	m := NewInboxModel(peer, ts, stubInboxActions{}, "peer-1", "wss://drop.lzart.com.br/ws")

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}})
	im := next.(InboxModel)
	if im.status != "" {
		t.Fatalf("expected empty status without PIN, got %q", im.status)
	}
}

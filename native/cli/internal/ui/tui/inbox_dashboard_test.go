package tui

import (
	"strings"
	"testing"

	"dropcli/internal/services"
	"dropcli/internal/state"
	"dropcli/internal/ui/text"

	tea "github.com/charmbracelet/bubbletea"
)

func manyOffers(n int) []services.PendingOffer {
	out := make([]services.PendingOffer, n)
	for i := 0; i < n; i++ {
		name := "file-" + strings.Repeat("x", i%5) + "-" + string(rune('A'+i%26)) + ".bin"
		out[i] = services.PendingOffer{
			FileID: "id-" + name,
			Name:   name,
			Size:   int64(100 + i),
		}
	}
	return out
}

func TestInboxViewFitsHeightBudget(t *testing.T) {
	peer := state.NewPeerState()
	peer.SetStatus(state.StatusConnected)
	peer.SetRole(state.RoleHost)
	peer.SetPIN("4242")
	ts := state.NewTransferState()
	stub := &offerStub{offers: manyOffers(40)}
	m := NewInboxModel(peer, ts, stub, "peer-1", "wss://example/ws")
	m.width = 60
	m.height = 20

	view := m.View()
	lines := strings.Split(view, "\n")
	// Split may leave a trailing empty from final newline.
	for len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) > m.height {
		t.Fatalf("view height %d exceeds terminal height %d:\n%s", len(lines), m.height, view)
	}
	if !strings.Contains(view, "f buscar") && !strings.Contains(view, "↑/↓") {
		t.Fatalf("footer help missing (%d lines):\n%s", len(lines), view)
	}
}

func TestInboxScrollKeepsCursorVisible(t *testing.T) {
	peer := state.NewPeerState()
	ts := state.NewTransferState()
	stub := &offerStub{offers: manyOffers(30)}
	m := NewInboxModel(peer, ts, stub, "peer-1", "wss://example/ws")
	m.width = 80
	m.height = 16

	for i := 0; i < 20; i++ {
		next, _ := m.Update(tea.KeyMsg{Type: tea.KeyDown})
		m = next.(InboxModel)
	}
	if m.cursor < m.scrollOffset || m.cursor >= m.scrollOffset+m.pendingPageSize() {
		t.Fatalf("cursor %d not in window [%d, %d)", m.cursor, m.scrollOffset, m.scrollOffset+m.pendingPageSize())
	}
	view := m.View()
	if !strings.Contains(view, "/") {
		// scroll hint uses en-dash style "1–8 / 30"
	}
	if !strings.Contains(view, text.PendingOffers) {
		t.Fatal("pending section missing")
	}
	// Scroll indicator when many rows
	if m.pendingPageSize() < len(m.visibleRows()) && !strings.Contains(view, "/") {
		t.Fatalf("expected scroll indicator, got:\n%s", view)
	}
}

func TestInboxHeaderLANBadgeOnlyWhenViaLan(t *testing.T) {
	peer := state.NewPeerState()
	peer.SetStatus(state.StatusConnected)
	peer.SetRole(state.RoleHost)
	peer.SetPIN("1111")
	peer.SetRemotePeer(state.NewRemotePeer("r1", "Alice"))
	peer.SetViaLan(true)
	ts := state.NewTransferState()
	m := NewInboxModel(peer, ts, &offerStub{}, "peer-1", "wss://example/ws")
	m.width, m.height = 80, 24

	view := m.View()
	if !strings.Contains(view, text.LabelLAN) {
		t.Fatalf("expected LAN badge when viaLan, got:\n%s", view)
	}
	if !strings.Contains(view, "Alice") {
		t.Fatalf("expected peer name, got:\n%s", view)
	}

	peer.SetViaLan(false)
	view = m.View()
	if strings.Contains(view, text.LabelLAN) {
		t.Fatalf("LAN badge must be absent when not viaLan:\n%s", view)
	}
}

func TestInboxEmptyStates(t *testing.T) {
	peer := state.NewPeerState()
	peer.SetStatus(state.StatusConnected)
	ts := state.NewTransferState()
	m := NewInboxModel(peer, ts, &offerStub{}, "peer-1", "wss://example/ws")
	m.width, m.height = 80, 24
	view := m.View()
	if !strings.Contains(view, text.PendingNone) {
		t.Fatalf("pending empty missing: %q", text.PendingNone)
	}
	if !strings.Contains(view, text.TransfersNone) {
		t.Fatalf("transfers empty missing: %q", text.TransfersNone)
	}
	if strings.Contains(view, "(nenhuma") {
		t.Fatal("old parenthetical empty copy must be gone")
	}
}

func TestRenderTransferItemActiveAndFailed(t *testing.T) {
	active := state.FileTransfer{
		Name:             "big.iso",
		Size:             1000,
		TransferredBytes: 250,
		Speed:            100,
		Status:           state.TransferActive,
		Direction:        state.DirectionReceive,
	}
	block, lines := renderTransferItem(active, 60)
	if lines < 2 {
		t.Fatalf("active transfer should be multi-line, got %d", lines)
	}
	if !strings.Contains(block, "big.iso") {
		t.Fatalf("missing name: %s", block)
	}
	if !strings.Contains(block, "%") {
		t.Fatalf("missing percent: %s", block)
	}
	if !strings.Contains(block, "ETA") {
		t.Fatalf("missing ETA: %s", block)
	}

	failed := state.FileTransfer{
		Name:      "x.bin",
		Status:    state.TransferFailed,
		Direction: state.DirectionSend,
		Error:     "boom",
	}
	block, _ = renderTransferItem(failed, 60)
	if !strings.Contains(block, "boom") {
		t.Fatalf("failed row must show error: %s", block)
	}
	if !strings.Contains(block, "✗") {
		t.Fatalf("failed row must use failure glyph: %s", block)
	}
}

func TestInboxJKDoNotNavigate(t *testing.T) {
	peer := state.NewPeerState()
	ts := state.NewTransferState()
	stub := &offerStub{offers: nestedOffers()}
	m := NewInboxModel(peer, ts, stub, "peer-1", "wss://example/ws")

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	m = next.(InboxModel)
	if m.cursor != 0 {
		t.Fatalf("j must not move cursor, got %d", m.cursor)
	}
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}})
	m = next.(InboxModel)
	if m.cursor != 0 {
		t.Fatalf("k must not move cursor, got %d", m.cursor)
	}

	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyDown})
	m = next.(InboxModel)
	if m.cursor != 1 {
		t.Fatalf("down must move cursor, got %d", m.cursor)
	}
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyUp})
	m = next.(InboxModel)
	if m.cursor != 0 {
		t.Fatalf("up must move cursor back, got %d", m.cursor)
	}
}

func TestInboxSearchMode(t *testing.T) {
	peer := state.NewPeerState()
	ts := state.NewTransferState()
	stub := &offerStub{offers: []services.PendingOffer{
		{FileID: "1", Name: "Ubuntu-24.04.iso", Size: 100},
		{FileID: "2", Name: "notes.txt", Size: 10},
		{FileID: "3", Name: "photos/nested/b.jpg", Size: 20},
	}}
	m := NewInboxModel(peer, ts, stub, "peer-1", "wss://example/ws")
	m.width, m.height = 80, 30

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'f'}})
	m = next.(InboxModel)
	if !m.searching {
		t.Fatal("f must enter search")
	}
	view := m.View()
	if !strings.Contains(view, text.InboxSearchHelp) {
		t.Fatalf("search footer missing:\n%s", view)
	}

	for _, r := range []rune("ubuntu") {
		next, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
		m = next.(InboxModel)
	}
	rows := m.visibleRows()
	if len(rows) != 1 || rows[0].name != "Ubuntu-24.04.iso" {
		t.Fatalf("expected ubuntu match, got %+v", rows)
	}

	pulledBefore := len(stub.pulled)
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = next.(InboxModel)
	if m.searching {
		t.Fatal("enter must leave search")
	}
	if len(stub.pulled) != pulledBefore {
		t.Fatal("enter in search must not download")
	}

	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'f'}})
	m = next.(InboxModel)
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'z'}})
	m = next.(InboxModel)
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	m = next.(InboxModel)
	if m.searching {
		t.Fatal("esc must leave search")
	}
	if m.quitting {
		t.Fatal("esc must not quit session")
	}
}

func TestInboxHelpIncludesFNoJK(t *testing.T) {
	if !strings.Contains(text.InboxHelp, "f buscar") {
		t.Fatalf("InboxHelp must advertise f: %q", text.InboxHelp)
	}
	lower := strings.ToLower(text.InboxHelp)
	if strings.Contains(lower, " j ") || strings.Contains(lower, " k ") || strings.HasPrefix(lower, "j ") {
		t.Fatalf("InboxHelp must not list j/k: %q", text.InboxHelp)
	}
	if strings.Contains(text.InboxHelp, "?") {
		t.Fatalf("InboxHelp must not advertise ?: %q", text.InboxHelp)
	}
}

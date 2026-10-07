package tui

import (
	"reflect"
	"sort"
	"strings"
	"testing"

	"dropcli/internal/services"
	"dropcli/internal/state"
	"dropcli/internal/ui/text"

	tea "github.com/charmbracelet/bubbletea"
)

type offerStub struct {
	offers []services.PendingOffer
	pulled [][]string
	dismissed [][]string
}

func (s *offerStub) SendPullBatch(fileIDs []string) error {
	s.pulled = append(s.pulled, append([]string{}, fileIDs...))
	return nil
}

func (s *offerStub) DismissPendingBatch(fileIDs []string) error {
	s.dismissed = append(s.dismissed, append([]string{}, fileIDs...))
	return nil
}

func (s *offerStub) PendingOffers() []services.PendingOffer {
	return s.offers
}

func nestedOffers() []services.PendingOffer {
	return []services.PendingOffer{
		{FileID: "a", Name: "photos/a.jpg", Size: 10},
		{FileID: "b", Name: "photos/nested/b.jpg", Size: 20},
		{FileID: "c", Name: "readme.txt", Size: 5},
	}
}

func TestBuildInboxRowsNestedVsBasename(t *testing.T) {
	rows := buildInboxRows(nestedOffers(), nil)
	got := rowSummary(rows)
	want := []string{"folder:photos", "file:readme.txt"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("root rows = %v, want %v", got, want)
	}

	rows = buildInboxRows(nestedOffers(), []string{"photos"})
	got = rowSummary(rows)
	want = []string{"..", "folder:nested", "file:a.jpg"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("photos rows = %v, want %v", got, want)
	}

	basenameOnly := []services.PendingOffer{
		{FileID: "1", Name: "solo.bin", Size: 1},
		{FileID: "2", Name: "z.txt", Size: 2},
	}
	rows = buildInboxRows(basenameOnly, nil)
	got = rowSummary(rows)
	want = []string{"file:solo.bin", "file:z.txt"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("basename rows = %v, want %v", got, want)
	}
}

func TestInboxViewShowsDotDotWhenNotRoot(t *testing.T) {
	peer := state.NewPeerState()
	ts := state.NewTransferState()
	stub := &offerStub{offers: nestedOffers()}
	m := NewInboxModel(peer, ts, stub, "peer-1", "wss://example/ws")
	m.cwd = []string{"photos"}

	view := m.View()
	if !strings.Contains(view, "..") {
		t.Fatalf("view must include .. when cwd non-root, got:\n%s", view)
	}
	if !strings.Contains(view, "nested/") {
		t.Fatalf("view must show folder trailing slash, got:\n%s", view)
	}
	if !strings.Contains(view, "a.jpg") {
		t.Fatalf("view must show file basename, got:\n%s", view)
	}
}

func TestInboxEnterEscDSeparation(t *testing.T) {
	peer := state.NewPeerState()
	ts := state.NewTransferState()
	stub := &offerStub{offers: nestedOffers()}
	m := NewInboxModel(peer, ts, stub, "peer-1", "wss://example/ws")

	// cursor 0 = photos folder
	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = next.(InboxModel)
	if !reflect.DeepEqual(m.cwd, []string{"photos"}) {
		t.Fatalf("enter folder cwd = %v, want [photos]", m.cwd)
	}
	if len(stub.pulled) != 0 {
		t.Fatalf("enter must not pull, got %v", stub.pulled)
	}

	// enter on file (a.jpg is after .. and nested/)
	m.cursor = 2
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyEnter})
	m = next.(InboxModel)
	if !reflect.DeepEqual(m.cwd, []string{"photos"}) {
		t.Fatalf("enter on file must keep cwd, got %v", m.cwd)
	}
	if len(stub.pulled) != 0 {
		t.Fatalf("enter on file must not pull")
	}

	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	m = next.(InboxModel)
	if len(m.cwd) != 0 {
		t.Fatalf("esc must go up to root, cwd=%v", m.cwd)
	}

	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyEsc})
	m = next.(InboxModel)
	if len(m.cwd) != 0 {
		t.Fatalf("esc at root must be no-op, cwd=%v", m.cwd)
	}
	if m.quitting {
		t.Fatal("esc at root must not quit")
	}

	// d downloads folder at cursor
	m.cursor = 0 // photos/
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'d'}})
	m = next.(InboxModel)
	if len(stub.pulled) != 1 {
		t.Fatalf("expected one pull batch, got %v", stub.pulled)
	}
	got := stub.pulled[0]
	sortStrings(got)
	want := []string{"a", "b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("folder pull ids = %v, want %v", got, want)
	}
}

func TestInboxFolderSelectionAndDismiss(t *testing.T) {
	peer := state.NewPeerState()
	ts := state.NewTransferState()
	stub := &offerStub{offers: nestedOffers()}
	m := NewInboxModel(peer, ts, stub, "peer-1", "wss://example/ws")

	// Space on photos folder
	m.cursor = 0
	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{' '}})
	m = next.(InboxModel)
	if !m.selected["a"] || !m.selected["b"] {
		t.Fatalf("space on folder must select descendants, selected=%v", m.selected)
	}
	if m.selected["c"] {
		t.Fatal("space on photos must not select readme")
	}

	// navigate into photos, Space on .. must not change selection
	m.cwd = []string{"photos"}
	m.cursor = 0
	before := len(m.selected)
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{' '}})
	m = next.(InboxModel)
	if len(m.selected) != before {
		t.Fatalf("space on .. must not change selection")
	}

	// clear and test cursor-only folder dismiss from root
	m.cwd = nil
	m.selected = make(map[string]bool)
	m.cursor = 0
	next, _ = m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'r'}})
	m = next.(InboxModel)
	if len(stub.dismissed) != 1 {
		t.Fatalf("expected one dismiss batch, got %v", stub.dismissed)
	}
	got := stub.dismissed[0]
	sortStrings(got)
	want := []string{"a", "b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("folder dismiss ids = %v, want %v", got, want)
	}
}

func TestInboxFolderPartialSelectionMark(t *testing.T) {
	peer := state.NewPeerState()
	ts := state.NewTransferState()
	stub := &offerStub{offers: nestedOffers()}
	m := NewInboxModel(peer, ts, stub, "peer-1", "wss://example/ws")

	// Select only deep file photos/nested/b.jpg
	m.selected["b"] = true
	view := m.View()
	if !strings.Contains(view, "[-] photos/") {
		t.Fatalf("partial descendant select must mark parent with [-], got:\n%s", view)
	}
	if strings.Contains(view, "[x] photos/") {
		t.Fatal("partial select must not show [x] on photos/")
	}

	// Select all under photos → [x]
	m.selected["a"] = true
	view = m.View()
	if !strings.Contains(view, "[x] photos/") {
		t.Fatalf("full folder select must show [x], got:\n%s", view)
	}
	if strings.Contains(view, "[-] photos/") {
		t.Fatal("full select must not show [-]")
	}

	// Inside photos: only nested/b selected → nested/ is fully selected ([x]), a.jpg unchecked
	m.selected = map[string]bool{"b": true}
	m.cwd = []string{"photos"}
	view = m.View()
	if !strings.Contains(view, "[x] nested/") {
		t.Fatalf("single selected descendant must show [x] on nested/, got:\n%s", view)
	}
	if strings.Contains(view, "[x] a.jpg") || strings.Contains(view, "[-] a.jpg") {
		t.Fatalf("a.jpg must stay unchecked, got:\n%s", view)
	}

	// Multi-file folder with partial select
	stub.offers = append(stub.offers, services.PendingOffer{FileID: "d", Name: "photos/nested/c.jpg", Size: 3})
	m.selected = map[string]bool{"b": true}
	view = m.View()
	if !strings.Contains(view, "[-] nested/") {
		t.Fatalf("partial multi-file folder must show [-], got:\n%s", view)
	}
}

func TestInboxHelpMentionsEnterEscNotEnterDownload(t *testing.T) {
	if !strings.Contains(text.InboxHelp, "enter") {
		t.Fatalf("InboxHelp must mention enter: %q", text.InboxHelp)
	}
	if !strings.Contains(text.InboxHelp, "esc") {
		t.Fatalf("InboxHelp must mention esc: %q", text.InboxHelp)
	}
	if !strings.Contains(text.InboxHelp, "d baixar") {
		t.Fatalf("InboxHelp must keep d baixar: %q", text.InboxHelp)
	}
	lower := strings.ToLower(text.InboxHelp)
	if strings.Contains(lower, "enter baixar") || strings.Contains(lower, "enter download") {
		t.Fatalf("InboxHelp must not imply enter downloads: %q", text.InboxHelp)
	}
}

func rowSummary(rows []inboxRow) []string {
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		switch r.kind {
		case inboxRowDotDot:
			out = append(out, "..")
		case inboxRowFolder:
			out = append(out, "folder:"+r.name)
		case inboxRowFile:
			out = append(out, "file:"+r.name)
		}
	}
	return out
}

func sortStrings(ids []string) {
	sort.Strings(ids)
}

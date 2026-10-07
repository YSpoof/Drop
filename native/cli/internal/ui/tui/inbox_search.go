package tui

import (
	"dropcli/internal/ui"
	"dropcli/internal/ui/text"
	"fmt"
	"sort"
	"strings"
	"unicode"

	tea "github.com/charmbracelet/bubbletea"
)

func (m InboxModel) updateSearch(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "ctrl+c":
		m.confirming = true
		setConfirmShowing(true)
		m.searching = false
		m.searchQuery = ""
		return m, nil
	case "esc":
		m.exitSearch(false)
		return m, nil
	case "enter":
		m.exitSearch(true)
		return m, nil
	case "up":
		if m.cursor > 0 {
			m.cursor--
			m.ensureCursorVisible()
		}
		return m, nil
	case "down":
		rows := m.visibleRows()
		if m.cursor < len(rows)-1 {
			m.cursor++
			m.ensureCursorVisible()
		}
		return m, nil
	case "backspace":
		if len(m.searchQuery) > 0 {
			runes := []rune(m.searchQuery)
			m.searchQuery = string(runes[:len(runes)-1])
			m.cursor = 0
			m.scrollOffset = 0
		}
		return m, nil
	case "d":
		m.applySearchTarget()
		ids, label := m.targetIDs()
		m.searching = false
		m.searchQuery = ""
		if len(ids) == 0 {
			m.status = text.NothingSelected
			return m, nil
		}
		if err := m.actions.SendPullBatch(ids); err != nil {
			m.status = fmt.Sprintf(text.DownloadFailed, err)
		} else {
			m.status = fmt.Sprintf(text.DownloadingNamed, label)
			m.clearSelection(ids)
			m.clampCursor()
		}
		return m, nil
	case "r", "x":
		m.applySearchTarget()
		ids, label := m.targetIDs()
		m.searching = false
		m.searchQuery = ""
		if len(ids) == 0 {
			m.status = text.NothingSelected
			return m, nil
		}
		if err := m.actions.DismissPendingBatch(ids); err != nil {
			m.status = fmt.Sprintf(text.RemoveFailed, err)
		} else {
			m.status = fmt.Sprintf(text.RemovedNamed, label)
			m.clearSelection(ids)
			m.clampCursor()
		}
		return m, nil
	case " ":
		m.toggleCursorSelection()
		return m, nil
	case "a":
		m.toggleSelectAllVisible()
		return m, nil
	case "c":
		pin := m.peerState.GetPIN()
		if pin != "" {
			if err := ui.CopyToClipboard(pin); err != nil {
				m.status = fmt.Sprintf(text.CopyPINFailed, err)
			} else {
				m.status = text.PINCopied
			}
		}
		return m, nil
	case "C":
		pin := m.peerState.GetPIN()
		if pin != "" && m.peerID != "" {
			link := ui.ShareURL(m.wsURL, m.peerID, pin)
			if err := ui.CopyToClipboard(link); err != nil {
				m.status = fmt.Sprintf(text.CopyLinkFailed, err)
			} else {
				m.status = text.ShareLinkCopied
			}
		}
		return m, nil
	case "q":
		m.quitting = true
		return m, tea.Quit
	default:
		if msg.Type == tea.KeyRunes {
			for _, r := range msg.Runes {
				if unicode.IsPrint(r) && r != '\n' && r != '\r' {
					m.searchQuery += string(r)
				}
			}
			m.cursor = 0
			m.scrollOffset = 0
		}
		return m, nil
	}
}

// exitSearch leaves search mode. If confirm, focus the highlighted result in browse mode.
func (m *InboxModel) exitSearch(confirm bool) {
	if confirm {
		m.applySearchTarget()
	}
	m.searching = false
	m.searchQuery = ""
	m.clampCursor()
	m.ensureCursorVisible()
}

// applySearchTarget maps the current search highlight into browse cwd/cursor.
func (m *InboxModel) applySearchTarget() {
	rows := m.visibleRows()
	if m.cursor < 0 || m.cursor >= len(rows) {
		return
	}
	row := rows[m.cursor]
	switch row.kind {
	case inboxRowFolder:
		// Stay at current level; find folder in browse rows after exit.
		target := row.name
		m.searching = false
		m.searchQuery = ""
		browse := buildInboxRows(m.actions.PendingOffers(), m.cwd)
		for i, r := range browse {
			if r.kind == inboxRowFolder && r.name == target {
				m.cursor = i
				return
			}
		}
	case inboxRowFile:
		if row.hint != "" {
			parts := pathSegments(row.hint)
			if len(parts) > 1 {
				m.cwd = append([]string{}, parts[:len(parts)-1]...)
			} else {
				m.cwd = nil
			}
			m.searching = false
			m.searchQuery = ""
			browse := buildInboxRows(m.actions.PendingOffers(), m.cwd)
			for i, r := range browse {
				if r.kind == inboxRowFile && r.fileID == row.fileID {
					m.cursor = i
					return
				}
			}
			return
		}
		targetID := row.fileID
		m.searching = false
		m.searchQuery = ""
		browse := buildInboxRows(m.actions.PendingOffers(), m.cwd)
		for i, r := range browse {
			if r.kind == inboxRowFile && r.fileID == targetID {
				m.cursor = i
				return
			}
		}
	default:
		m.searching = false
		m.searchQuery = ""
	}
}

func (m InboxModel) searchRows(query string) []inboxRow {
	q := strings.ToLower(query)
	local := buildInboxRows(m.actions.PendingOffers(), m.cwd)
	var hits []inboxRow
	for _, row := range local {
		if row.kind == inboxRowDotDot {
			continue
		}
		name := strings.ToLower(row.name)
		if strings.Contains(name, q) {
			hits = append(hits, row)
		}
	}
	if len(hits) > 0 {
		return hits
	}

	// No local hits: surface deeper file matches as flat results.
	prefix := strings.Join(m.cwd, "/")
	for _, o := range m.actions.PendingOffers() {
		path := normalizeOfferPath(o.Name)
		if prefix != "" && !offerUnderPrefix(path, prefix) {
			continue
		}
		parts := pathSegments(path)
		if len(parts) <= len(m.cwd)+1 {
			continue // already covered by local file rows
		}
		base := parts[len(parts)-1]
		if !strings.Contains(strings.ToLower(base), q) && !strings.Contains(strings.ToLower(path), q) {
			continue
		}
		hits = append(hits, inboxRow{
			kind:   inboxRowFile,
			name:   base,
			fileID: o.FileID,
			size:   o.Size,
			hint:   path,
		})
	}
	sort.SliceStable(hits, func(i, j int) bool {
		return hits[i].hint < hits[j].hint
	})
	return hits
}

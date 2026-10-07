package tui

import (
	"sort"
	"strings"

	"dropcli/internal/services"
)

func (m *InboxModel) enterRow() {
	rows := m.visibleRows()
	if m.cursor < 0 || m.cursor >= len(rows) {
		return
	}
	row := rows[m.cursor]
	switch row.kind {
	case inboxRowDotDot:
		m.goUp()
	case inboxRowFolder:
		m.cwd = append(append([]string{}, m.cwd...), row.name)
		m.cursor = 0
		m.scrollOffset = 0
	case inboxRowFile:
		// no-op: Enter never downloads
	}
}

func (m *InboxModel) goUp() {
	if len(m.cwd) == 0 {
		return
	}
	m.cwd = append([]string{}, m.cwd[:len(m.cwd)-1]...)
	m.cursor = 0
	m.scrollOffset = 0
}

func (m *InboxModel) clampCursor() {
	rows := m.visibleRows()
	if len(rows) == 0 {
		m.cursor = 0
		return
	}
	if m.cursor >= len(rows) {
		m.cursor = len(rows) - 1
	}
	if m.cursor < 0 {
		m.cursor = 0
	}
}

func (m *InboxModel) ensureCursorVisible() {
	page := m.pendingPageSize()
	if page <= 0 {
		return
	}
	rows := m.visibleRows()
	n := len(rows)
	if n == 0 {
		m.scrollOffset = 0
		return
	}
	if m.cursor < m.scrollOffset {
		m.scrollOffset = m.cursor
	}
	if m.cursor >= m.scrollOffset+page {
		m.scrollOffset = m.cursor - page + 1
	}
	maxOff := n - page
	if maxOff < 0 {
		maxOff = 0
	}
	if m.scrollOffset > maxOff {
		m.scrollOffset = maxOff
	}
	if m.scrollOffset < 0 {
		m.scrollOffset = 0
	}
}

func (m *InboxModel) clampCwd() {
	for len(m.cwd) > 0 {
		prefix := strings.Join(m.cwd, "/")
		if len(m.descendantFileIDs(prefix)) > 0 {
			return
		}
		m.cwd = m.cwd[:len(m.cwd)-1]
		m.cursor = 0
		m.scrollOffset = 0
	}
}

func (m InboxModel) visibleRows() []inboxRow {
	if m.searching && m.searchQuery != "" {
		return m.searchRows(m.searchQuery)
	}
	if m.searching {
		return buildInboxRows(m.actions.PendingOffers(), m.cwd)
	}
	return buildInboxRows(m.actions.PendingOffers(), m.cwd)
}

func buildInboxRows(offers []services.PendingOffer, cwd []string) []inboxRow {
	prefix := strings.Join(cwd, "/")
	folders := map[string]string{} // segment -> prefix
	var files []inboxRow

	for _, o := range offers {
		parts := pathSegments(normalizeOfferPath(o.Name))
		if !segmentsHavePrefix(parts, cwd) {
			continue
		}
		rest := parts[len(cwd):]
		if len(rest) == 0 {
			continue
		}
		if len(rest) == 1 {
			files = append(files, inboxRow{
				kind:   inboxRowFile,
				name:   rest[0],
				fileID: o.FileID,
				size:   o.Size,
			})
			continue
		}
		seg := rest[0]
		folderPrefix := seg
		if prefix != "" {
			folderPrefix = prefix + "/" + seg
		}
		folders[seg] = folderPrefix
	}

	// Name that is both file and folder → folder wins (remove file row).
	folderNames := make([]string, 0, len(folders))
	for name := range folders {
		folderNames = append(folderNames, name)
	}
	sort.Strings(folderNames)
	folderSet := make(map[string]bool, len(folderNames))
	for _, name := range folderNames {
		folderSet[name] = true
	}

	sort.SliceStable(files, func(i, j int) bool {
		return files[i].name < files[j].name
	})
	filteredFiles := files[:0]
	for _, f := range files {
		if folderSet[f.name] {
			continue
		}
		filteredFiles = append(filteredFiles, f)
	}
	files = filteredFiles

	rows := make([]inboxRow, 0, 1+len(folderNames)+len(files))
	if len(cwd) > 0 {
		rows = append(rows, inboxRow{kind: inboxRowDotDot, name: ".."})
	}
	for _, name := range folderNames {
		rows = append(rows, inboxRow{
			kind:   inboxRowFolder,
			name:   name,
			prefix: folders[name],
		})
	}
	rows = append(rows, files...)
	return rows
}

func normalizeOfferPath(name string) string {
	normalized := strings.ReplaceAll(name, "\\", "/")
	return strings.Trim(normalized, "/")
}

func pathSegments(name string) []string {
	if name == "" {
		return nil
	}
	raw := strings.Split(name, "/")
	parts := make([]string, 0, len(raw))
	for _, p := range raw {
		if p == "" || p == "." {
			continue
		}
		parts = append(parts, p)
	}
	return parts
}

func segmentsHavePrefix(parts, prefix []string) bool {
	if len(parts) < len(prefix) {
		return false
	}
	for i, seg := range prefix {
		if parts[i] != seg {
			return false
		}
	}
	return true
}

func offerUnderPrefix(name, prefix string) bool {
	if prefix == "" {
		return name != ""
	}
	return name == prefix || strings.HasPrefix(name, prefix+"/")
}

func uniqueIDs(ids []string) []string {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[string]bool, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out
}

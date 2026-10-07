package tui

import (
	"dropcli/internal/ui/text"
	"fmt"
)

func (m *InboxModel) toggleCursorSelection() {
	rows := m.visibleRows()
	if m.cursor < 0 || m.cursor >= len(rows) {
		return
	}
	row := rows[m.cursor]
	ids := m.rowFileIDs(row)
	if len(ids) == 0 {
		return
	}
	if m.allSelected(ids) {
		for _, id := range ids {
			delete(m.selected, id)
		}
		return
	}
	for _, id := range ids {
		m.selected[id] = true
	}
}

func (m *InboxModel) toggleSelectAllVisible() {
	rows := m.visibleRows()
	var ids []string
	for _, row := range rows {
		ids = append(ids, m.rowFileIDs(row)...)
	}
	ids = uniqueIDs(ids)
	if len(ids) == 0 {
		return
	}
	if m.allSelected(ids) {
		m.selected = make(map[string]bool)
		return
	}
	for _, id := range ids {
		m.selected[id] = true
	}
}

func (m InboxModel) allSelected(ids []string) bool {
	if len(ids) == 0 {
		return false
	}
	for _, id := range ids {
		if !m.selected[id] {
			return false
		}
	}
	return true
}

func (m InboxModel) anySelected(ids []string) bool {
	for _, id := range ids {
		if m.selected[id] {
			return true
		}
	}
	return false
}

// folderCheckMark returns [ ], [-], or [x] for a folder's descendant selection state.
func (m InboxModel) folderCheckMark(ids []string) string {
	if len(ids) == 0 {
		return "[ ]"
	}
	if m.allSelected(ids) {
		return "[x]"
	}
	if m.anySelected(ids) {
		return "[-]"
	}
	return "[ ]"
}

func (m InboxModel) rowFileIDs(row inboxRow) []string {
	switch row.kind {
	case inboxRowFile:
		if row.fileID == "" {
			return nil
		}
		return []string{row.fileID}
	case inboxRowFolder:
		return m.descendantFileIDs(row.prefix)
	default:
		return nil
	}
}

func (m InboxModel) descendantFileIDs(prefix string) []string {
	var ids []string
	for _, o := range m.actions.PendingOffers() {
		if offerUnderPrefix(normalizeOfferPath(o.Name), prefix) {
			ids = append(ids, o.FileID)
		}
	}
	return ids
}

// targetIDs returns selected file IDs, or the cursor row expansion if none selected.
func (m InboxModel) targetIDs() (ids []string, label string) {
	offers := m.actions.PendingOffers()
	if len(offers) == 0 {
		return nil, ""
	}

	for _, o := range offers {
		if m.selected[o.FileID] {
			ids = append(ids, o.FileID)
		}
	}
	if len(ids) > 0 {
		if len(ids) == 1 {
			for _, o := range offers {
				if o.FileID == ids[0] {
					return ids, o.Name
				}
			}
		}
		return ids, fmt.Sprintf(text.NFiles, len(ids))
	}

	rows := m.visibleRows()
	if m.cursor < 0 || m.cursor >= len(rows) {
		return nil, ""
	}
	row := rows[m.cursor]
	ids = m.rowFileIDs(row)
	if len(ids) == 0 {
		return nil, ""
	}
	switch row.kind {
	case inboxRowFile:
		if row.hint != "" {
			return ids, row.hint
		}
		return ids, row.name
	case inboxRowFolder:
		if len(ids) == 1 {
			for _, o := range offers {
				if o.FileID == ids[0] {
					return ids, o.Name
				}
			}
		}
		return ids, row.name + "/"
	default:
		return nil, ""
	}
}

func (m *InboxModel) clearSelection(ids []string) {
	for _, id := range ids {
		delete(m.selected, id)
	}
}

func (m *InboxModel) pruneSelection() {
	offers := m.actions.PendingOffers()
	alive := make(map[string]bool, len(offers))
	for _, o := range offers {
		alive[o.FileID] = true
	}
	for id := range m.selected {
		if !alive[id] {
			delete(m.selected, id)
		}
	}
}

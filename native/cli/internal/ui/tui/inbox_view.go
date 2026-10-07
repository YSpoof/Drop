package tui

import (
	"fmt"
	"strings"

	"dropcli/internal/state"
	"dropcli/internal/ui/text"
)

func (m InboxModel) pendingPageSize() int {
	pendingH, _ := m.layoutHeights()
	return pendingH
}

// layoutHeights returns pending body lines and transfer body lines that fit
// under a reserved header+footer budget for the current terminal height.
func (m InboxModel) layoutHeights() (pendingH, transferH int) {
	h := m.height
	if h <= 0 {
		// Untamed height (tests without WindowSize): show a generous window.
		return 40, 20
	}

	// Fixed chrome lines produced by View (no panel padding counted here):
	// title(1) + header(1-2) + divider(1) + pending label(1) + divider(1) +
	// transfers label(1) + footer help(1) [+ search prompt] [+ status]
	headerLines := 2 // title + status
	pin := m.peerState.GetPIN()
	_, hasPeer := m.peerState.GetRemotePeer()
	if pin != "" || hasPeer {
		headerLines = 3 // + peer/PIN meta line
	}
	chrome := headerLines + 1 /*div*/ + 1 /*pending lbl*/ + 1 /*div*/ + 1 /*xfer lbl*/
	footerLines := 1
	if m.searching {
		footerLines = 2
	}
	if m.status != "" {
		footerLines++
	}
	remaining := h - chrome - footerLines
	if remaining < 4 {
		remaining = 4
	}
	pendingH = remaining * 2 / 3
	transferH = remaining - pendingH
	if pendingH < 1 {
		pendingH = 1
	}
	if transferH < 1 {
		transferH = 1
	}
	return pendingH, transferH
}

func (m InboxModel) View() string {
	if m.quitting {
		return ""
	}
	if m.confirming {
		return ConfirmOverlayView(m.width, m.height)
	}

	width := m.width
	if width <= 0 {
		width = 80
	}
	height := m.height
	if height <= 0 {
		height = 100
	}

	pendingH, transferH := m.layoutHeights()

	var sb strings.Builder

	// Header
	sb.WriteString(titleStyle.Render(truncateWidth(text.InboxTitle, width)))
	sb.WriteString("\n")

	connStatus := m.peerState.GetStatus()
	role := m.peerState.GetRole()
	pin := m.peerState.GetPIN()
	peerName := ""
	if remotePeer, ok := m.peerState.GetRemotePeer(); ok {
		peerName = remotePeer.GetDisplayName()
	}
	sb.WriteString(renderCompactHeader(connStatus, role, pin, peerName, m.peerState.GetViaLan(), width))
	sb.WriteString("\n")

	sb.WriteString(dividerStyle.Render(strings.Repeat("─", min(40, width))))
	sb.WriteString("\n")

	// Pending panel
	pendingLabel := statusStyle.Render(text.PendingOffers)
	rows := m.visibleRows()
	if len(rows) > pendingH {
		from := m.scrollOffset + 1
		to := min(m.scrollOffset+pendingH, len(rows))
		pendingLabel += "  " + dimStyle.Render(fmt.Sprintf(text.ScrollHint, from, to, len(rows)))
	}
	sb.WriteString(pendingLabel)
	sb.WriteString("\n")

	if len(rows) == 0 {
		sb.WriteString(dimStyle.Render(truncateWidth(text.PendingNone, width)))
		sb.WriteString("\n")
	} else {
		start := m.scrollOffset
		if start < 0 {
			start = 0
		}
		end := start + pendingH
		if end > len(rows) {
			end = len(rows)
		}
		for i := start; i < end; i++ {
			row := rows[i]
			cursor := "  "
			style := statusStyle
			if i == m.cursor {
				cursor = "> "
				style = activeFileStyle
			}
			line := m.renderRow(cursor, row, width)
			sb.WriteString(style.Render(line))
			sb.WriteString("\n")
		}
	}

	sb.WriteString(dividerStyle.Render(strings.Repeat("─", min(40, width))))
	sb.WriteString("\n")
	sb.WriteString(statusStyle.Render(text.Transfers))
	sb.WriteString("\n")

	transfers := m.nonPendingTransfers()
	used := 0
	if len(transfers) == 0 {
		sb.WriteString(dimStyle.Render(truncateWidth(text.TransfersNone, width)))
		sb.WriteString("\n")
	} else {
		for _, t := range transfers {
			block, lines := renderTransferItem(t, width)
			if used+lines > transferH && used > 0 {
				break
			}
			sb.WriteString(block)
			sb.WriteString("\n")
			used += lines
			if used >= transferH {
				break
			}
		}
	}

	// Footer — always last; wrap hints on narrow terminals.
	var footer string
	if m.searching {
		footer = accentStyle.Render(fmt.Sprintf(text.SearchPrompt, m.searchQuery+"▌")) + "\n" +
			dimStyle.Render(wrapWidth(text.InboxSearchHelp, width))
	} else {
		footer = dimStyle.Render(wrapWidth(text.InboxHelp, width))
	}
	if m.status != "" {
		footer += "\n" + statusStyle.Render(truncateWidth(m.status, width))
	}

	body := sb.String()
	footerLines := strings.Split(footer, "\n")
	footerH := len(footerLines)
	if m.height > 0 {
		bodyLines := strings.Split(strings.TrimRight(body, "\n"), "\n")
		maxBody := m.height - footerH
		if maxBody < 1 {
			maxBody = 1
		}
		if len(bodyLines) > maxBody {
			bodyLines = bodyLines[:maxBody]
		}
		return strings.Join(append(bodyLines, footerLines...), "\n")
	}
	return strings.TrimRight(body, "\n") + "\n" + footer
}

func (m InboxModel) nonPendingTransfers() []state.FileTransfer {
	all := m.transferState.GetAll()
	out := make([]state.FileTransfer, 0, len(all))
	// Prefer active first, then newest-ish (reverse order of GetAll).
	var active, rest []state.FileTransfer
	for _, t := range all {
		if t.Status == state.TransferPending {
			continue
		}
		if t.Status == state.TransferActive {
			active = append(active, t)
		} else {
			rest = append(rest, t)
		}
	}
	out = append(out, active...)
	for i := len(rest) - 1; i >= 0; i-- {
		out = append(out, rest[i])
	}
	return out
}

func (m InboxModel) renderRow(cursor string, row inboxRow, width int) string {
	var line string
	switch row.kind {
	case inboxRowDotDot:
		line = fmt.Sprintf("%s%s", cursor, row.name)
	case inboxRowFolder:
		check := m.folderCheckMark(m.descendantFileIDs(row.prefix))
		line = fmt.Sprintf("%s%s %s/", cursor, check, row.name)
	default:
		check := "[ ]"
		if m.selected[row.fileID] {
			check = "[x]"
		}
		if row.hint != "" {
			line = fmt.Sprintf("%s%s %s  %s  (%s)", cursor, check, row.name, FormatBytes(row.size), row.hint)
		} else {
			line = fmt.Sprintf("%s%s %s  %s", cursor, check, row.name, FormatBytes(row.size))
		}
	}
	return truncateWidth(line, width)
}

// Err returns a transport error if the session ended due to failure.
func (m InboxModel) Err() error { return m.err }

// PeerBye reports whether the peer sent bye.
func (m InboxModel) PeerBye() bool { return m.bye }

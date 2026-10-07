package tui

import (
	"fmt"
	"strings"
	"time"

	"dropcli/internal/state"
	"dropcli/internal/ui/text"

	"github.com/charmbracelet/lipgloss"
)

// statusGlyph returns a compact connection indicator.
func statusGlyph(status state.ConnectionStatus) string {
	switch status {
	case state.StatusConnected:
		return okStyle.Render("●")
	case state.StatusConnecting, state.StatusWaitingReconnect:
		return warnStyle.Render("●")
	case state.StatusFailed, state.StatusDisconnected:
		return errStyle.Render("●")
	default:
		return dimStyle.Render("○")
	}
}

// statusLabelPtBR maps connection status to pt-BR chrome copy.
func statusLabelPtBR(status state.ConnectionStatus) string {
	switch status {
	case state.StatusIdle:
		return text.StatusIdle
	case state.StatusConnecting:
		return text.StatusConnecting
	case state.StatusConnected:
		return text.StatusConnected
	case state.StatusDisconnected:
		return text.StatusDisconnected
	case state.StatusFailed:
		return text.StatusFailed
	case state.StatusWaitingReconnect:
		return text.StatusWaitingReconnect
	default:
		return string(status)
	}
}

// renderCompactHeader builds the dashboard header line(s).
func renderCompactHeader(status state.ConnectionStatus, role state.Role, pin string, peerName string, viaLan bool, width int) string {
	roleLabel := text.RoleHostLabel
	if role == state.RoleJoiner {
		roleLabel = text.RoleJoinLabel
	}

	line1 := fmt.Sprintf("%s %s [%s]",
		statusGlyph(status),
		statusStyle.Render(statusLabelPtBR(status)),
		roleLabel,
	)
	if viaLan {
		line1 += " " + okStyle.Render(text.LabelLAN)
	}

	var parts []string
	parts = append(parts, truncateWidth(line1, width))

	var meta []string
	if peerName != "" {
		meta = append(meta, statusStyle.Render(fmt.Sprintf(text.ConnectedTo, truncateWidth(peerName, max(8, width/3)))))
	}
	if pin != "" {
		meta = append(meta, fmt.Sprintf(text.PINLabel, pinStyle.Render(pin)))
	}
	if len(meta) > 0 {
		parts = append(parts, truncateWidth(strings.Join(meta, "  "), width))
	}
	return strings.Join(parts, "\n")
}

// renderTransferItem renders a compact multi-line transfer block.
// Returns the rendered string and how many visual lines it uses.
func renderTransferItem(t state.FileTransfer, width int) (string, int) {
	icon := "○"
	var style lipgloss.Style

	switch t.Status {
	case state.TransferPending:
		icon = "○"
		style = statusStyle
	case state.TransferActive:
		icon = "●"
		style = activeFileStyle
	case state.TransferCompleted:
		icon = "✓"
		style = completedFileStyle
	case state.TransferCancelled, state.TransferFailed:
		icon = "✗"
		style = failedFileStyle
	}

	direction := "↓"
	if t.Direction == state.DirectionSend {
		direction = "↑"
	}

	nameWidth := width - 6
	if nameWidth < 8 {
		nameWidth = 8
	}
	name := truncateWidth(t.Name, nameWidth)
	line1 := style.Render(fmt.Sprintf("%s %s %s", icon, direction, name))

	var lines []string
	lines = append(lines, line1)

	if t.Status == state.TransferActive || t.Status == state.TransferCompleted {
		pct := 0.0
		if t.Size > 0 {
			pct = float64(t.TransferredBytes) / float64(t.Size) * 100
		}
		barWidth := 20
		if width > 0 && width < 40 {
			barWidth = max(6, width/3)
		}
		bar := progressBar(pct, barWidth)
		bytesPart := ""
		if t.Size > 0 {
			bytesPart = fmt.Sprintf(" %s/%s", FormatBytes(t.TransferredBytes), FormatBytes(t.Size))
		} else if t.TransferredBytes > 0 {
			bytesPart = fmt.Sprintf(" %s", FormatBytes(t.TransferredBytes))
		}
		meta := fmt.Sprintf("%s %3.0f%%%s", bar, pct, bytesPart)
		if t.Status == state.TransferActive && t.Speed > 0 {
			meta += rateStyle.Render(fmt.Sprintf("  %s/s", FormatBytes(int64(t.Speed))))
			if eta := formatETA(t); eta != "" {
				meta += rateStyle.Render("  ETA " + eta)
			}
		}
		lines = append(lines, truncateWidth(meta, width))
	}

	if t.Error != "" && (t.Status == state.TransferFailed || t.Status == state.TransferCancelled) {
		lines = append(lines, truncateWidth(failedFileStyle.Render(t.Error), width))
	}

	return strings.Join(lines, "\n"), len(lines)
}

func progressBar(pct float64, width int) string {
	if width < 4 {
		width = 4
	}
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	filled := int(pct / 100 * float64(width))
	if filled > width {
		filled = width
	}
	bar := strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
	return statusStyle.Render(bar)
}

func formatETA(t state.FileTransfer) string {
	if t.Speed <= 0 || t.Size <= 0 || t.TransferredBytes >= t.Size {
		return ""
	}
	remaining := float64(t.Size - t.TransferredBytes)
	secs := remaining / t.Speed
	d := time.Duration(secs * float64(time.Second))
	if d < time.Second {
		return "<1s"
	}
	if d < time.Minute {
		return fmt.Sprintf("%ds", int(d.Seconds()))
	}
	if d < time.Hour {
		m := int(d.Minutes())
		s := int(d.Seconds()) % 60
		return fmt.Sprintf("%dm%02ds", m, s)
	}
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	return fmt.Sprintf("%dh%02dm", h, m)
}

// truncateWidth shortens s to fit maxWidth cells, appending ellipsis when needed.
func truncateWidth(s string, maxWidth int) string {
	if maxWidth <= 0 {
		return s
	}
	if lipgloss.Width(s) <= maxWidth {
		return s
	}
	if maxWidth <= 1 {
		return "…"
	}
	// Walk runes until visual width would exceed maxWidth-1 (room for ellipsis).
	var b strings.Builder
	w := 0
	for _, r := range s {
		rw := lipgloss.Width(string(r))
		if w+rw >= maxWidth {
			break
		}
		b.WriteRune(r)
		w += rw
	}
	return b.String() + "…"
}

// wrapWidth wraps s onto multiple lines at maxWidth (word-aware when possible).
func wrapWidth(s string, maxWidth int) string {
	if maxWidth <= 0 || lipgloss.Width(s) <= maxWidth {
		return s
	}
	words := strings.Fields(s)
	if len(words) == 0 {
		return truncateWidth(s, maxWidth)
	}
	var lines []string
	var cur strings.Builder
	curW := 0
	for _, word := range words {
		ww := lipgloss.Width(word)
		if curW == 0 {
			if ww > maxWidth {
				lines = append(lines, truncateWidth(word, maxWidth))
				continue
			}
			cur.WriteString(word)
			curW = ww
			continue
		}
		if curW+1+ww > maxWidth {
			lines = append(lines, cur.String())
			cur.Reset()
			if ww > maxWidth {
				lines = append(lines, truncateWidth(word, maxWidth))
				curW = 0
				continue
			}
			cur.WriteString(word)
			curW = ww
			continue
		}
		cur.WriteByte(' ')
		cur.WriteString(word)
		curW += 1 + ww
	}
	if cur.Len() > 0 {
		lines = append(lines, cur.String())
	}
	return strings.Join(lines, "\n")
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// FormatBytes formats byte counts in human-readable form.
func FormatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(b)/float64(div), "KMG"[exp])
}

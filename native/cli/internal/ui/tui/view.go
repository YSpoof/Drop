package tui

import (
	"fmt"
	"strings"

	"dropcli/internal/state"
	"dropcli/internal/ui/text"

	"github.com/charmbracelet/lipgloss"
)

// Shared styles for inbox / transfer progress rendering.
var (
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("12")).
			MarginBottom(1)

	pinStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("10")).
			Background(lipgloss.Color("0")).
			Padding(0, 1)

	statusStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("14"))

	activeFileStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("11")).
			Bold(true)

	completedFileStyle = lipgloss.NewStyle().
				Foreground(lipgloss.Color("2"))

	failedFileStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("1"))

	rateStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("8"))

	dividerStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("8"))
)

// renderConnectionInfo renders the connection status and PIN.
func renderConnectionInfo(status state.ConnectionStatus, role state.Role, pin string) string {
	roleLabel := text.RoleHostLabel
	if role == state.RoleJoiner {
		roleLabel = text.RoleJoinLabel
	}

	statusLabel := string(status)
	switch status {
	case state.StatusIdle:
		statusLabel = text.StatusIdle
	case state.StatusConnecting:
		statusLabel = text.StatusConnecting
	case state.StatusConnected:
		statusLabel = text.StatusConnected
	case state.StatusDisconnected:
		statusLabel = text.StatusDisconnected
	case state.StatusFailed:
		statusLabel = text.StatusFailed
	case state.StatusWaitingReconnect:
		statusLabel = text.StatusWaitingReconnect
	}

	parts := []string{statusStyle.Render(fmt.Sprintf("[%s] %s", roleLabel, statusLabel))}
	if pin != "" {
		parts = append(parts, fmt.Sprintf(text.PINLabel, pinStyle.Render(pin)))
	}
	return strings.Join(parts, "  ")
}

// renderTransferItem renders a single file transfer entry.
func renderTransferItem(t state.FileTransfer) string {
	icon := "  "
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
	case state.TransferCancelled:
		icon = "✗"
		style = failedFileStyle
	case state.TransferFailed:
		icon = "✗"
		style = failedFileStyle
	}

	direction := "↓"
	if t.Direction == state.DirectionSend {
		direction = "↑"
	}

	var progress string
	if t.Size > 0 {
		pct := float64(t.TransferredBytes) / float64(t.Size) * 100
		progress = fmt.Sprintf(" %s/%s (%.0f%%)",
			FormatBytes(t.TransferredBytes),
			FormatBytes(t.Size),
			pct,
		)
	}

	var rate string
	if t.Status == state.TransferActive && t.Speed > 0 {
		rate = rateStyle.Render(fmt.Sprintf(" [%s/s]", FormatBytes(int64(t.Speed))))
	}

	line := fmt.Sprintf("%s %s %s%s%s", icon, direction, t.Name, progress, rate)

	if t.Error != "" && (t.Status == state.TransferFailed || t.Status == state.TransferCancelled) {
		line += failedFileStyle.Render(fmt.Sprintf(" (%s)", t.Error))
	}

	return style.Render(line)
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

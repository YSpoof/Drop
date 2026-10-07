package tui

import (
	"fmt"
	"strings"
	"time"

	"dropcli/internal/services"
	"dropcli/internal/state"
	"dropcli/internal/ui"
	"dropcli/internal/ui/text"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type inboxTickMsg time.Time

type inboxRefreshMsg struct{}

type inboxErrMsg struct{ err error }

type inboxByeMsg struct{}

// InboxActions drives pull/dismiss against the transfer layer.
type InboxActions interface {
	SendPullBatch(fileIDs []string) error
	DismissPendingBatch(fileIDs []string) error
	PendingOffers() []services.PendingOffer
}

// InboxModel is the interactive receive inbox after WebRTC is ready.
type InboxModel struct {
	peerState     *state.PeerState
	transferState *state.TransferState
	actions       InboxActions
	peerID        string
	wsURL         string

	cursor     int
	selected   map[string]bool
	status     string
	quitting   bool
	bye        bool
	err        error
	confirming bool
	width      int
	height     int
}

// NewInboxModel builds an inbox session model.
// peerID and wsURL enable host copy-PIN / copy-share-link shortcuts.
func NewInboxModel(peerState *state.PeerState, transferState *state.TransferState, actions InboxActions, peerID, wsURL string) InboxModel {
	return InboxModel{
		peerState:     peerState,
		transferState: transferState,
		actions:       actions,
		peerID:        peerID,
		wsURL:         wsURL,
		selected:      make(map[string]bool),
	}
}

func (m InboxModel) Init() tea.Cmd {
	return tea.Batch(inboxTick(), tea.EnterAltScreen)
}

func inboxTick() tea.Cmd {
	return tea.Tick(200*time.Millisecond, func(t time.Time) tea.Msg {
		return inboxTickMsg(t)
	})
}

// InboxRefresh returns a message that refreshes pending offers.
func InboxRefresh() tea.Msg { return inboxRefreshMsg{} }

// InboxBye returns a message that ends the session because the peer left.
func InboxBye() tea.Msg { return inboxByeMsg{} }

// InboxError returns a message that ends the session on transport failure.
func InboxError(err error) tea.Msg { return inboxErrMsg{err: err} }

func (m InboxModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	case tea.KeyMsg:
		if m.confirming {
			switch msg.String() {
			case "ctrl+c":
				setConfirmShowing(false)
				m.confirming = false
				m.quitting = true
				return m, tea.Quit
			case "esc":
				m.confirming = false
				setConfirmShowing(false)
				return m, nil
			}
			return m, nil
		}
		switch msg.String() {
		case "ctrl+c":
			m.confirming = true
			setConfirmShowing(true)
			return m, nil
		case "q":
			m.quitting = true
			return m, tea.Quit
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			offers := m.actions.PendingOffers()
			if m.cursor < len(offers)-1 {
				m.cursor++
			}
		case " ":
			offers := m.actions.PendingOffers()
			if len(offers) == 0 || m.cursor >= len(offers) {
				break
			}
			id := offers[m.cursor].FileID
			if m.selected[id] {
				delete(m.selected, id)
			} else {
				m.selected[id] = true
			}
		case "a":
			offers := m.actions.PendingOffers()
			allSelected := len(offers) > 0
			for _, o := range offers {
				if !m.selected[o.FileID] {
					allSelected = false
					break
				}
			}
			if allSelected {
				m.selected = make(map[string]bool)
			} else {
				for _, o := range offers {
					m.selected[o.FileID] = true
				}
			}
		case "d", "enter":
			ids, label := m.targetIDs()
			if len(ids) == 0 {
				m.status = text.NothingSelected
				break
			}
			if err := m.actions.SendPullBatch(ids); err != nil {
				m.status = fmt.Sprintf(text.DownloadFailed, err)
			} else {
				m.status = fmt.Sprintf(text.DownloadingNamed, label)
				m.clearSelection(ids)
				m.clampCursor()
			}
		case "r", "x":
			ids, label := m.targetIDs()
			if len(ids) == 0 {
				m.status = text.NothingSelected
				break
			}
			if err := m.actions.DismissPendingBatch(ids); err != nil {
				m.status = fmt.Sprintf(text.RemoveFailed, err)
			} else {
				m.status = fmt.Sprintf(text.RemovedNamed, label)
				m.clearSelection(ids)
				m.clampCursor()
			}
		case "c":
			pin := m.peerState.GetPIN()
			if pin == "" {
				break
			}
			if err := ui.CopyToClipboard(pin); err != nil {
				m.status = fmt.Sprintf(text.CopyPINFailed, err)
			} else {
				m.status = text.PINCopied
			}
		case "C":
			pin := m.peerState.GetPIN()
			if pin == "" || m.peerID == "" {
				break
			}
			link := ui.ShareURL(m.wsURL, m.peerID, pin)
			if err := ui.CopyToClipboard(link); err != nil {
				m.status = fmt.Sprintf(text.CopyLinkFailed, err)
			} else {
				m.status = text.ShareLinkCopied
			}
		}
	case inboxTickMsg:
		return m, inboxTick()
	case inboxRefreshMsg:
		m.pruneSelection()
		m.clampCursor()
	case inboxByeMsg:
		if m.confirming {
			setConfirmShowing(false)
			m.confirming = false
		}
		m.bye = true
		m.quitting = true
		return m, tea.Quit
	case inboxErrMsg:
		if m.confirming {
			setConfirmShowing(false)
			m.confirming = false
		}
		m.err = msg.err
		m.quitting = true
		return m, tea.Quit
	}
	return m, nil
}

// targetIDs returns selected file IDs, or the cursor row if none selected.
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

	if m.cursor < 0 || m.cursor >= len(offers) {
		return nil, ""
	}
	return []string{offers[m.cursor].FileID}, offers[m.cursor].Name
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

func (m *InboxModel) clampCursor() {
	offers := m.actions.PendingOffers()
	if len(offers) == 0 {
		m.cursor = 0
		return
	}
	if m.cursor >= len(offers) {
		m.cursor = len(offers) - 1
	}
	if m.cursor < 0 {
		m.cursor = 0
	}
}

func (m InboxModel) View() string {
	if m.quitting {
		return ""
	}
	if m.confirming {
		return ConfirmOverlayView(m.width, m.height)
	}

	var sb strings.Builder
	sb.WriteString(titleStyle.Render(text.InboxTitle))
	sb.WriteString("\n")

	connStatus := m.peerState.GetStatus()
	role := m.peerState.GetRole()
	pin := m.peerState.GetPIN()
	sb.WriteString(renderConnectionInfo(connStatus, role, pin))
	if pin != "" {
		sb.WriteString("\n")
		sb.WriteString(rateStyle.Render(text.CopyPINHint))
	}
	sb.WriteString("\n")
	if connStatus == state.StatusWaitingReconnect {
		sb.WriteString(statusStyle.Render(text.StatusWaitingReconnect))
		sb.WriteString("\n")
	} else if remotePeer, ok := m.peerState.GetRemotePeer(); ok {
		sb.WriteString(statusStyle.Render(fmt.Sprintf(text.ConnectedTo, remotePeer.GetDisplayName())))
		sb.WriteString("\n")
	}

	sb.WriteString(dividerStyle.Render(strings.Repeat("─", 40)))
	sb.WriteString("\n")
	sb.WriteString(statusStyle.Render(text.PendingOffers))
	sb.WriteString("\n")

	offers := m.actions.PendingOffers()
	if len(offers) == 0 {
		sb.WriteString(rateStyle.Render(text.PendingNone))
		sb.WriteString("\n")
	} else {
		for i, o := range offers {
			cursor := "  "
			style := statusStyle
			if i == m.cursor {
				cursor = "> "
				style = activeFileStyle
			}
			check := "[ ]"
			if m.selected[o.FileID] {
				check = "[x]"
			}
			line := fmt.Sprintf("%s%s %s  %s", cursor, check, o.Name, FormatBytes(o.Size))
			sb.WriteString(style.Render(line))
			sb.WriteString("\n")
		}
	}

	sb.WriteString("\n")
	sb.WriteString(statusStyle.Render(text.Transfers))
	sb.WriteString("\n")
	transfers := m.transferState.GetAll()
	shown := 0
	for _, t := range transfers {
		if t.Status == state.TransferPending {
			continue
		}
		sb.WriteString(renderTransferItem(t))
		sb.WriteString("\n")
		shown++
	}
	if shown == 0 {
		sb.WriteString(rateStyle.Render(text.TransfersNone))
		sb.WriteString("\n")
	}

	sb.WriteString("\n")
	help := lipgloss.NewStyle().Foreground(lipgloss.Color("8")).Render(text.InboxHelp)

	sb.WriteString(help)
	sb.WriteString("\n")
	if m.status != "" {
		sb.WriteString(statusStyle.Render(m.status))
		sb.WriteString("\n")
	}
	return sb.String()
}

// Err returns a transport error if the session ended due to failure.
func (m InboxModel) Err() error { return m.err }

// PeerBye reports whether the peer sent bye.
func (m InboxModel) PeerBye() bool { return m.bye }

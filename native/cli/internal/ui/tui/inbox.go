package tui

import (
	"fmt"
	"time"

	"dropcli/internal/services"
	"dropcli/internal/state"
	"dropcli/internal/ui"
	"dropcli/internal/ui/text"

	tea "github.com/charmbracelet/bubbletea"
)

type inboxTickMsg time.Time

type inboxRefreshMsg struct{}

type inboxErrMsg struct{ err error }

type inboxByeMsg struct{}

type inboxRowKind int

const (
	inboxRowDotDot inboxRowKind = iota
	inboxRowFolder
	inboxRowFile
)

type inboxRow struct {
	kind   inboxRowKind
	name   string // display segment (".." / folder / file basename)
	prefix string // folder path prefix under root (joined with /)
	fileID string
	size   int64
	hint   string // optional path hint for deep search hits
}

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

	cwd          []string
	cursor       int
	scrollOffset int
	selected     map[string]bool
	status       string
	quitting     bool
	bye          bool
	err          error
	confirming   bool
	searching    bool
	searchQuery  string
	width        int
	height       int
}

// NewInboxModel builds an inbox session model.
// peerID and wsURL enable host copy-PIN / share-link shortcuts.
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
	// Alt screen: tea.WithAltScreen on NewProgram. ClearScreen + WindowSize force
	// a full first paint after hostkeys stdin handoff (avoids blank until keypress).
	return tea.Batch(tea.ClearScreen, tea.WindowSize(), inboxTick())
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
		m.ensureCursorVisible()
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
		if m.searching {
			return m.updateSearch(msg)
		}
		switch msg.String() {
		case "ctrl+c":
			m.confirming = true
			setConfirmShowing(true)
			return m, nil
		case "q":
			m.quitting = true
			return m, tea.Quit
		case "up":
			if m.cursor > 0 {
				m.cursor--
				m.ensureCursorVisible()
			}
		case "down":
			rows := m.visibleRows()
			if m.cursor < len(rows)-1 {
				m.cursor++
				m.ensureCursorVisible()
			}
		case "f":
			m.searching = true
			m.searchQuery = ""
			m.cursor = 0
			m.scrollOffset = 0
		case "enter":
			m.enterRow()
		case "esc":
			m.goUp()
		case " ":
			m.toggleCursorSelection()
		case "a":
			m.toggleSelectAllVisible()
		case "d":
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
		m.clampCwd()
		m.clampCursor()
		m.ensureCursorVisible()
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

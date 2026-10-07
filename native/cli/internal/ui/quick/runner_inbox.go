package quick

import (
	"context"
	"fmt"
	"os"

	"dropcli/internal/services"
	"dropcli/internal/state"
	"dropcli/internal/ui/text"
	"dropcli/internal/ui/tui"
	"dropcli/internal/webrtc"

	tea "github.com/charmbracelet/bubbletea"
)

type runnerInboxActions struct {
	transfer *services.TransferService
	download *services.DownloadService
}

func (a runnerInboxActions) SendPullBatch(fileIDs []string) error {
	return a.transfer.SendPullBatch(fileIDs)
}

func (a runnerInboxActions) DismissPendingBatch(fileIDs []string) error {
	return a.transfer.DismissPendingBatch(fileIDs)
}

func (a runnerInboxActions) PendingOffers() []services.PendingOffer {
	return a.download.PendingOffers()
}

func (r *Runner) runReceiveInbox(
	ctx context.Context,
	errCh <-chan error,
	byeCh <-chan struct{},
	disconnectCh <-chan struct{},
	readyCh <-chan struct{},
	sessionStartedCh <-chan struct{},
) error {
	actions := runnerInboxActions{transfer: r.transferSvc, download: r.downloadSvc}
	model := tui.NewInboxModel(
		r.peerState,
		r.transferState,
		actions,
		r.deviceState.GetPeerID(),
		r.settings.GetWSURL(),
	)
	// Inbox owns Ctrl+C confirm; watcher only drains SIGINT so the process is not killed.
	tui.SetTeaOwnsSIGINT(true)
	defer tui.SetTeaOwnsSIGINT(false)
	r.setInboxUI(true)
	defer r.setInboxUI(false)
	// Use os.Stdout/Stdin directly (term.File) so bubbletea can MakeRaw, alt-screen,
	// and WindowSize after hostkeys release — r.Stdout may be a non-File wrapper.
	p := tea.NewProgram(
		model,
		tea.WithContext(ctx),
		tea.WithAltScreen(),
		tea.WithOutput(os.Stdout),
		tea.WithInput(os.Stdin),
	)

	r.downloadSvc.SetOnPendingChange(func() {
		p.Send(tui.InboxRefresh())
	})
	r.downloadSvc.SetOnComplete(func(name string, size int64) {
		p.Send(tui.InboxRefresh())
	})

	cfg := &QuickConfig{Host: r.peerState.GetRole() == state.RoleHost, ConnectPIN: r.peerState.GetPIN()}

	go func() {
		for {
			select {
			case <-ctx.Done():
				p.Send(tea.Quit())
				return
			case err := <-errCh:
				if err != nil {
					p.Send(tui.InboxError(err))
				}
				return
			case <-byeCh:
				p.Send(tui.InboxBye())
				return
			case <-disconnectCh:
				_ = r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh)
				p.Send(tui.InboxRefresh())
			}
		}
	}()

	final, err := p.Run()
	if err != nil {
		r.discardAllDrops()
		return err
	}
	if m, ok := final.(tui.InboxModel); ok {
		if m.Err() != nil {
			r.discardAllDrops()
			return m.Err()
		}
		if m.PeerBye() {
			fmt.Fprint(r.Stdout, text.PeerClosedSession)
			return nil
		}
	}
	// User quit / cancel — discard incomplete partials.
	r.discardAllDrops()
	if ctx.Err() != nil {
		_ = r.transferSvc.SendControl(webrtc.ByeMessage{Type: webrtc.CtrlBye})
		return ctx.Err()
	}
	_ = r.transferSvc.SendControl(webrtc.ByeMessage{Type: webrtc.CtrlBye})
	return nil
}

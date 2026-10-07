package quick

import (
	"context"
	"errors"
	"fmt"
	"time"

	"dropcli/internal/ports"
	"dropcli/internal/state"
	"dropcli/internal/ui/text"
	"dropcli/internal/ui/tui"
	"dropcli/internal/webrtc"
)

const resumeAfterDisconnect = 2 * time.Second

// tryBeginSession returns true if a new WebRTC session may start.
func (r *Runner) tryBeginSession() bool {
	r.sessionGate.Lock()
	defer r.sessionGate.Unlock()
	if r.sessionActive {
		return false
	}
	r.sessionActive = true
	return true
}

// resetSessionGate allows a subsequent peer pairing to create a new session.
func (r *Runner) resetSessionGate() {
	r.sessionGate.Lock()
	r.sessionActive = false
	r.sessionGate.Unlock()
}

// SignalErrorIsFatal reports whether a HandleSignal failure should end the process.
// Post-ready / closed-PC failures are recoverable disconnects.
func SignalErrorIsFatal(everReady bool, sessionNilOrClosed bool) bool {
	if sessionNilOrClosed {
		return false
	}
	return !everReady
}

// Run executes the headless quick mode lifecycle.
func (r *Runner) Run(ctx context.Context, cfg *QuickConfig) error {
	if err := cfg.ValidateWithRepo(r.repo); err != nil {
		return err
	}

	// Session cancel is confirm-gated on TTY (SIGINT overlay / raw Ctrl+C).
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stopSig := tui.WatchSIGINTConfirm(ctx, cancel)
	defer stopSig()

	if cfg.OutputDir != "" {
		r.settings.SetDownloadDir(cfg.OutputDir)
	}
	if err := r.repo.EnsureDir(r.settings.GetDownloadDir()); err != nil {
		return fmt.Errorf(text.ErrEnsureDownloadDir, err)
	}

	r.settings.SetAutoDownload(cfg.AutoDownload)

	if cfg.Host {
		r.peerState.SetRole(state.RoleHost)
	} else {
		r.peerState.SetRole(state.RoleJoiner)
		r.peerState.SetPIN(cfg.ConnectPIN)
	}

	readyCh := make(chan struct{}, 1)
	sessionStartedCh := make(chan struct{}, 1)
	disconnectCh := make(chan struct{}, 1)
	byeCh := make(chan struct{}, 1)
	errCh := make(chan error, 4)

	notifyDisconnect := func() {
		select {
		case disconnectCh <- struct{}{}:
		default:
		}
	}

	startSession := func(remotePeer ports.SignalingPeerInfo) {
		if !r.tryBeginSession() {
			return
		}
		r.peerState.SetRemotePeer(state.NewRemotePeer(remotePeer.ID, remotePeer.DisplayName))
		r.peerState.SetViaLan(remotePeer.Lan)

		webrtcHandler := &quickWebRTCHandler{
			r:                r,
			remotePeerID:     remotePeer.ID,
			readyCh:          readyCh,
			errCh:            errCh,
			notifyDisconnect: notifyDisconnect,
		}

		r.mu.Lock()
		r.webrtcSession = webrtc.NewSession(webrtcHandler, r.sessionConfig)
		r.mu.Unlock()

		select {
		case sessionStartedCh <- struct{}{}:
		default:
		}

		if err := r.webrtcSession.Start(r.deviceState.GetPeerID(), remotePeer.ID); err != nil {
			r.resetSessionGate()
			select {
			case errCh <- fmt.Errorf(text.ErrWebRTCStart, err):
			default:
			}
		}
	}

	sigHandler := &quickSignalingHandler{
		r:                r,
		cfg:              cfg,
		startSession:     startSession,
		errCh:            errCh,
		notifyDisconnect: notifyDisconnect,
	}

	r.signalingPort.SetHandler(sigHandler)

	if err := r.signalingPort.Connect(ctx, r.settings.GetWSURL()); err != nil {
		return fmt.Errorf(text.ErrConnectSignaling, err)
	}
	defer r.signalingPort.Close()
	defer func() {
		r.mu.Lock()
		sess := r.webrtcSession
		r.mu.Unlock()
		if sess != nil {
			_ = sess.Close()
		}
	}()

	// Wait for peer pairing (no timeout — host may wait indefinitely for a joiner).
	// Host TTY: c/C copy PIN / share link while waiting.
	// Cancel + wait done before inbox so hostkeys Restore cannot race tea.MakeRaw.
	hostKeysCtx, hostKeysCancel := context.WithCancel(ctx)
	defer hostKeysCancel()
	var hostKeysDone <-chan struct{}
	if cfg.Host {
		hostKeysDone = r.hostCopyKeys(hostKeysCtx, cancel)
	}
	stopHostKeys := func() {
		hostKeysCancel()
		if hostKeysDone == nil {
			return
		}
		// Handoff closes when TTY is restored (not when Read fully unwinds).
		select {
		case <-hostKeysDone:
		case <-time.After(500 * time.Millisecond):
			// Safety: never block inbox forever if a reader refuses to die.
		}
	}
	select {
	case <-ctx.Done():
		stopHostKeys()
		r.discardAllDrops()
		return ctx.Err()
	case err := <-errCh:
		stopHostKeys()
		return err
	case <-sessionStartedCh:
		stopHostKeys()
	}

	// Wait for first WebRTC ready after pairing
	if err := r.waitReady(ctx, readyCh, errCh, disconnectCh, 15*time.Second, false); err != nil {
		return err
	}
	r.onSessionReady()

	r.transferSvc.SetOnBye(func() {
		select {
		case byeCh <- struct{}{}:
		default:
		}
	})

	hasSend := len(cfg.SendFiles) > 0
	hasWatch := len(cfg.WatchDirs) > 0

	if cfg.ReceiveInbox {
		if hasSend || hasWatch {
			go func() {
				_ = r.runOutbound(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh)
			}()
		}
		// Hostkeys barrier already waited above; inbox tea owns stdin from here.
		return r.runReceiveInbox(ctx, errCh, byeCh, disconnectCh, readyCh, sessionStartedCh)
	}

	if hasWatch {
		return r.runWatchLoop(ctx, cfg, readyCh, errCh, disconnectCh, byeCh, sessionStartedCh)
	}

	if hasSend {
		return r.runSendFilesLoop(ctx, cfg, readyCh, errCh, disconnectCh, byeCh, sessionStartedCh)
	}

	return r.runReceiveWait(ctx, errCh, byeCh, disconnectCh, readyCh, sessionStartedCh)
}

// runOutbound sends one-shot files and/or watches dirs (used under interactive inbox).
func (r *Runner) runOutbound(
	ctx context.Context,
	cfg *QuickConfig,
	readyCh <-chan struct{},
	errCh <-chan error,
	disconnectCh <-chan struct{},
	sessionStartedCh <-chan struct{},
) error {
	if len(cfg.WatchDirs) > 0 {
		return r.runWatchLoop(ctx, cfg, readyCh, errCh, disconnectCh, nil, sessionStartedCh)
	}
	if len(cfg.SendFiles) > 0 {
		return r.runSendFilesLoop(ctx, cfg, readyCh, errCh, disconnectCh, nil, sessionStartedCh)
	}
	return nil
}

func (r *Runner) waitReady(
	ctx context.Context,
	readyCh <-chan struct{},
	errCh <-chan error,
	disconnectCh <-chan struct{},
	timeout time.Duration,
	reconnectWait bool,
) error {
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-errCh:
			if reconnectWait {
				fmt.Fprintf(r.Stderr, text.ReconnectAttemptError, err)
				continue
			}
			return err
		case <-disconnectCh:
			if reconnectWait {
				continue
			}
			return errors.New(text.ErrWebRTCDisconnectedBeforeReady)
		case <-readyCh:
			return nil
		case <-timer.C:
			if reconnectWait {
				// Keep waiting forever while reconnecting.
				timer.Reset(timeout)
				continue
			}
			return errors.New(text.ErrWebRTCTimeout)
		}
	}
}

func (r *Runner) onSessionReady() {
	r.mu.Lock()
	r.everReady = true
	r.waitingReconnect = false
	peerID := ""
	if remote, ok := r.peerState.GetRemotePeer(); ok {
		peerID = remote.GetID()
	}
	prev := r.lastConnectedPeerID
	if prev != "" && peerID != "" && prev != peerID {
		_ = r.downloadSvc.DropIncomplete("")
	}
	if peerID != "" {
		r.lastConnectedPeerID = peerID
	}
	r.mu.Unlock()

	r.transferSvc.ResetPeerAbort()
	r.peerState.SetStatus(state.StatusConnected)
}

func (r *Runner) enterWaitReconnect(disconnectCh <-chan struct{}) {
	r.mu.Lock()
	r.waitingReconnect = true
	r.mu.Unlock()

	r.peerState.SetStatus(state.StatusWaitingReconnect)
	r.peerState.SetViaLan(false)
	r.consoleFprint(r.Stdout, text.WaitingReconnect)

	r.transferSvc.AbortPeerLoss()

	r.mu.Lock()
	sess := r.webrtcSession
	r.webrtcSession = nil
	r.mu.Unlock()
	if sess != nil && !sess.IsClosed() {
		_ = sess.Close()
	}
	r.resetSessionGate()

	// Drain extra disconnect signals.
	for {
		select {
		case <-disconnectCh:
		default:
			return
		}
	}
}

func (r *Runner) waitForReconnect(
	ctx context.Context,
	cfg *QuickConfig,
	readyCh <-chan struct{},
	errCh <-chan error,
	disconnectCh <-chan struct{},
	sessionStartedCh <-chan struct{},
) error {
	r.enterWaitReconnect(disconnectCh)

	select {
	case <-ctx.Done():
		r.discardAllDrops()
		return ctx.Err()
	case <-time.After(resumeAfterDisconnect):
	}

	// Joiner may need to re-announce / re-join after peer leave.
	if !cfg.Host {
		_ = r.signalingPort.SendAnnounce(r.deviceState.GetPeerID(), false, r.deviceState.GetDisplayName())
		_ = r.signalingPort.SendJoinCode(r.deviceState.GetPeerID(), cfg.ConnectPIN)
	}

	for {
		select {
		case <-ctx.Done():
			r.discardAllDrops()
			return ctx.Err()
		case err := <-errCh:
			r.consoleFprintf(r.Stderr, text.ReconnectWait, err)
		case <-sessionStartedCh:
			if err := r.waitReady(ctx, readyCh, errCh, disconnectCh, 15*time.Second, true); err != nil {
				if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
					r.discardAllDrops()
					return err
				}
				r.consoleFprintf(r.Stderr, text.ReconnectReadyFailed, err)
				r.enterWaitReconnect(disconnectCh)
				continue
			}
			r.onSessionReady()
			return nil
		case <-disconnectCh:
			// Still waiting.
		}
	}
}

func (r *Runner) discardAllDrops() {
	_ = r.downloadSvc.DropIncomplete("")
}


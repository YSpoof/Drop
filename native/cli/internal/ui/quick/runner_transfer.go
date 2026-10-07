package quick

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"dropcli/internal/adapters/watcher"
	"dropcli/internal/ports"
	"dropcli/internal/services"
	"dropcli/internal/state"
	"dropcli/internal/ui/text"
	"dropcli/internal/ui/tui"
	"dropcli/internal/webrtc"

	pionwebrtc "github.com/pion/webrtc/v4"
)

func (r *Runner) runSendFilesLoop(
	ctx context.Context,
	cfg *QuickConfig,
	readyCh <-chan struct{},
	errCh <-chan error,
	disconnectCh <-chan struct{},
	_ <-chan struct{},
	sessionStartedCh <-chan struct{},
) error {
	for _, file := range cfg.SendFiles {
		fmt.Fprintf(r.Stdout, text.TransferringFile, file)
		r.transferSvc.EnqueueSend(file, filepath.Base(file))
	}

	for {
		err := r.transferSvc.DrainSendQueue(ctx)
		if err == nil {
			for _, file := range cfg.SendFiles {
				fmt.Fprintf(r.Stdout, text.TransferComplete, file)
			}
			time.Sleep(150 * time.Millisecond)
			return nil
		}
		if errors.Is(err, services.ErrPeerAbort) || errors.Is(err, context.Canceled) {
			if ctx.Err() != nil {
				r.discardAllDrops()
				return ctx.Err()
			}
			if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
				return err
			}
			continue
		}
		// Also watch for disconnect racing with send completion.
		select {
		case <-disconnectCh:
			if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
				return err
			}
			continue
		default:
		}
		first := ""
		if len(cfg.SendFiles) > 0 {
			first = cfg.SendFiles[0]
		}
		return fmt.Errorf(text.ErrSendFile, first, err)
	}
}

func (r *Runner) runWatchLoop(
	ctx context.Context,
	cfg *QuickConfig,
	readyCh <-chan struct{},
	errCh <-chan error,
	disconnectCh <-chan struct{},
	_ <-chan struct{},
	sessionStartedCh <-chan struct{},
) error {
	// One-shot file positionals first; completion must not end the watch session.
	if len(cfg.SendFiles) > 0 {
		for _, file := range cfg.SendFiles {
			fmt.Fprintf(r.Stdout, text.TransferringFile, file)
			r.transferSvc.EnqueueSend(file, filepath.Base(file))
		}
		for {
			err := r.transferSvc.DrainSendQueue(ctx)
			if err == nil {
				for _, file := range cfg.SendFiles {
					fmt.Fprintf(r.Stdout, text.TransferComplete, file)
				}
				break
			}
			if errors.Is(err, services.ErrPeerAbort) || errors.Is(err, context.Canceled) {
				if ctx.Err() != nil {
					r.discardAllDrops()
					return ctx.Err()
				}
				if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
					return err
				}
				continue
			}
			select {
			case <-disconnectCh:
				if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
					return err
				}
				continue
			default:
			}
			first := cfg.SendFiles[0]
			return fmt.Errorf(text.ErrSendFile, first, err)
		}
	}

	wp, err := watcher.New()
	if err != nil {
		return fmt.Errorf(text.ErrCreateWatcher, err)
	}
	watcherSvc := services.NewFolderWatcherService(wp, r.repo)
	defer watcherSvc.Close()

	for _, dir := range cfg.WatchDirs {
		if err := watcherSvc.Watch(dir); err != nil {
			return fmt.Errorf(text.ErrWatchDir, dir, err)
		}
		fmt.Fprintf(r.Stdout, text.WatchingDir, dir)
	}

	for {
		select {
		case <-ctx.Done():
			r.discardAllDrops()
			return ctx.Err()
		case err := <-errCh:
			return err
		case <-disconnectCh:
			if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
				return err
			}
		case <-watcherSvc.Notify():
			for {
				path, ok := watcherSvc.Dequeue()
				if !ok {
					break
				}
				announce := watcherSvc.AnnounceName(path)
				fmt.Fprintf(r.Stdout, text.BroadcastingFile, path, announce)
				r.transferSvc.EnqueueSend(path, announce)
			}
			if err := r.transferSvc.DrainSendQueue(ctx); err != nil {
				if errors.Is(err, services.ErrPeerAbort) {
					if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
						return err
					}
					continue
				}
				fmt.Fprintf(r.Stderr, text.FailedSendQueued, err)
			}
		}
	}
}

func (r *Runner) runReceiveWait(
	ctx context.Context,
	errCh <-chan error,
	byeCh <-chan struct{},
	disconnectCh <-chan struct{},
	readyCh <-chan struct{},
	sessionStartedCh <-chan struct{},
) error {
	fmt.Fprint(r.Stdout, text.ConnectedWaitingFiles)

	var batchMu sync.Mutex
	receivedSinceBatch := 0
	r.downloadSvc.SetOnComplete(func(name string, size int64) {
		batchMu.Lock()
		receivedSinceBatch++
		batchMu.Unlock()
		fmt.Fprintf(r.Stdout, text.ReceivedFile, name, tui.FormatBytes(size))
	})
	r.transferSvc.SetOnBatchDone(func() {
		batchMu.Lock()
		n := receivedSinceBatch
		receivedSinceBatch = 0
		batchMu.Unlock()
		if n == 0 {
			return
		}
		fmt.Fprintf(r.Stdout, text.BatchComplete, n)
	})

	cfg := &QuickConfig{Host: r.peerState.GetRole() == state.RoleHost, ConnectPIN: r.peerState.GetPIN()}

	for {
		select {
		case <-ctx.Done():
			_ = r.transferSvc.SendControl(webrtc.ByeMessage{Type: webrtc.CtrlBye})
			r.discardAllDrops()
			return ctx.Err()
		case err := <-errCh:
			return err
		case <-byeCh:
			fmt.Fprint(r.Stdout, text.PeerClosedSession)
			return nil
		case <-disconnectCh:
			if err := r.waitForReconnect(ctx, cfg, readyCh, errCh, disconnectCh, sessionStartedCh); err != nil {
				return err
			}
			fmt.Fprint(r.Stdout, text.ReconnectedWaitingFiles)
		}
	}
}

type quickSignalingHandler struct {
	r                *Runner
	cfg              *QuickConfig
	startSession     func(remotePeer ports.SignalingPeerInfo)
	errCh            chan error
	notifyDisconnect func()
}

func (h *quickSignalingHandler) OnConnected() {
	if h.cfg.Host {
		_ = h.r.signalingPort.SendAnnounce(h.r.deviceState.GetPeerID(), true, h.r.deviceState.GetDisplayName())
	} else {
		_ = h.r.signalingPort.SendAnnounce(h.r.deviceState.GetPeerID(), false, h.r.deviceState.GetDisplayName())
		_ = h.r.signalingPort.SendJoinCode(h.r.deviceState.GetPeerID(), h.cfg.ConnectPIN)
	}
}

func (h *quickSignalingHandler) OnCodeAssigned(code string) {
	h.r.peerState.SetPIN(code)
	fprintfHostWait(h.r.Stdout, text.AssignedPIN, code)
	if h.cfg.Host {
		writeHostWait(h.r.Stdout, text.PressCopyHint)
	}
}

func (h *quickSignalingHandler) OnPeerJoining(peer ports.SignalingPeerInfo) {
	// May race with host raw mode — use CRLF-aware writer.
	// Skip when inbox tea owns the TTY (reconnect); status is in the inbox chrome.
	if !h.r.inboxUIActive() {
		fprintfHostWait(h.r.Stdout, text.PeerJoined, peer.DisplayName)
	}
	h.startSession(peer)
}

func (h *quickSignalingHandler) OnJoinAccepted(peer ports.SignalingPeerInfo) {
	h.r.consoleFprintf(h.r.Stdout, text.JoinAccepted, peer.DisplayName)
	h.startSession(peer)
}

func (h *quickSignalingHandler) OnJoinRejected(reason string) {
	h.r.peerState.SetStatus(state.StatusFailed)
	select {
	case h.errCh <- fmt.Errorf(text.ErrJoinRejected, reason):
	default:
	}
}

func (h *quickSignalingHandler) OnSignal(fromPeerID string, signalData []byte) {
	h.r.mu.Lock()
	sess := h.r.webrtcSession
	everReady := h.r.everReady
	h.r.mu.Unlock()

	if sess == nil || sess.IsClosed() {
		// Stale signals while no active session — ignore (not fatal).
		return
	}
	if err := sess.HandleSignal(signalData); err != nil {
		closed := sess.IsClosed() || isClosedPCError(err)
		if !SignalErrorIsFatal(everReady, closed) {
			h.notifyDisconnect()
			return
		}
		select {
		case h.errCh <- fmt.Errorf(text.ErrWebRTCSignal, err):
		default:
		}
	}
}

func (h *quickSignalingHandler) OnDisconnected(err error) {
	h.r.peerState.SetStatus(state.StatusDisconnected)
}

func (h *quickSignalingHandler) OnError(err error) {
	select {
	case h.errCh <- fmt.Errorf(text.ErrSignaling, err):
	default:
	}
}

type quickWebRTCHandler struct {
	r                *Runner
	remotePeerID     string
	readyCh          chan struct{}
	errCh            chan error
	notifyDisconnect func()
}

func (w *quickWebRTCHandler) OnSignal(data []byte) {
	_ = w.r.signalingPort.SendSignal(w.r.deviceState.GetPeerID(), w.remotePeerID, data)
}

func (w *quickWebRTCHandler) OnReady(ctrl *pionwebrtc.DataChannel, files *pionwebrtc.DataChannel) {
	w.r.peerState.SetStatus(state.StatusConnected)
	w.r.transferSvc.BindChannels(ctrl, files)

	ctrl.OnClose(func() {
		w.r.mu.Lock()
		everReady := w.r.everReady
		w.r.mu.Unlock()
		if everReady {
			w.notifyDisconnect()
		}
	})

	w.r.mu.Lock()
	sess := w.r.webrtcSession
	w.r.mu.Unlock()

	if sess != nil {
		if pc := sess.GetPeerConnection(); pc != nil {
			chunkSize := webrtc.GetMaxChunkSize(pc)
			w.r.transferSvc.SetChunkSize(chunkSize)
		}
	}

	manual := !w.r.settings.GetAutoDownload()
	if err := w.r.transferSvc.SendDownloadMode(manual); err != nil {
		w.r.consoleFprintf(w.r.Stderr, text.FailedAnnounceMode, err)
	} else {
		w.r.consoleFprintf(w.r.Stderr, text.AnnouncedDownloadMode, manual)
	}

	select {
	case w.readyCh <- struct{}{}:
	default:
	}
}

func (w *quickWebRTCHandler) OnStateChange(s pionwebrtc.PeerConnectionState) {
	switch s {
	case pionwebrtc.PeerConnectionStateConnected:
		w.r.peerState.SetStatus(state.StatusConnected)
	case pionwebrtc.PeerConnectionStateDisconnected:
		w.r.peerState.SetStatus(state.StatusDisconnected)
	case pionwebrtc.PeerConnectionStateFailed, pionwebrtc.PeerConnectionStateClosed:
		w.r.mu.Lock()
		everReady := w.r.everReady
		w.r.mu.Unlock()
		if everReady {
			w.r.peerState.SetStatus(state.StatusWaitingReconnect)
			w.notifyDisconnect()
			return
		}
		w.r.peerState.SetStatus(state.StatusFailed)
		select {
		case w.errCh <- errors.New(text.ErrWebRTCPeerFailed):
		default:
		}
	}
}

func (w *quickWebRTCHandler) OnClose() {
	w.r.mu.Lock()
	everReady := w.r.everReady
	waiting := w.r.waitingReconnect
	w.r.mu.Unlock()
	if everReady && !waiting {
		w.notifyDisconnect()
		return
	}
	w.r.peerState.SetStatus(state.StatusDisconnected)
}

func isClosedPCError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "closed") ||
		strings.Contains(msg, "invalid state") ||
		(strings.Contains(msg, "connection") && strings.Contains(msg, "close"))
}

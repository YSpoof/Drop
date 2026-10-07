package quick

import (
	"context"
	"errors"
	"io"
	"os"
	"sync"
	"time"

	"dropcli/internal/ui"
	"dropcli/internal/ui/text"
	"dropcli/internal/ui/tui"
	"dropcli/libs/breakread"

	"golang.org/x/term"
)

// hostConfirmExit runs the Ctrl+C confirm overlay during host PIN wait.
// Tests may override; production uses tui.RunConfirmExit.
var hostConfirmExit = tui.RunConfirmExit

// TTY helpers — tests may stub so host-key paths run on pipes without a PTY.
var (
	hostIsTerminal = term.IsTerminal
	hostMakeRaw    = term.MakeRaw
	hostRestore    = term.Restore
)

// hostCopyKeys watches stdin for c/C while a host PIN is known.
// Non-TTY stdin is a no-op. Safe to cancel via ctx.
// onConfirm is invoked when the user confirms exit via the Ctrl+C overlay.
// Returns a channel that closes when the TTY has been restored and is safe for
// the inbox tea program to take over (may close before the read loop unwinds).
func (r *Runner) hostCopyKeys(ctx context.Context, onConfirm func()) <-chan struct{} {
	return r.hostCopyKeysFrom(ctx, os.Stdin, onConfirm)
}

// hostCopyKeysFrom is like hostCopyKeys but reads from in (for tests).
func (r *Runner) hostCopyKeysFrom(ctx context.Context, in *os.File, onConfirm func()) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		r.watchHostCopyKeys(ctx, in, onConfirm, done)
	}()
	return done
}

func (r *Runner) watchHostCopyKeys(ctx context.Context, in *os.File, onConfirm func(), handoff chan struct{}) {
	var handoffOnce sync.Once
	signalHandoff := func() {
		handoffOnce.Do(func() { close(handoff) })
	}
	defer signalHandoff()

	if in == nil || !hostCopyKeysEnabled(in) {
		return
	}
	fd := int(in.Fd())

	cr, err := breakread.New(in)
	if err != nil {
		return
	}
	defer func() {
		cr.Cancel()
		_ = cr.Close()
	}()

	var rawMu sync.Mutex
	var oldState *term.State
	raw := false

	leaveRaw := func() {
		rawMu.Lock()
		defer rawMu.Unlock()
		if !raw {
			return
		}
		raw = false
		setHostRawActive(false)
		if oldState != nil {
			_ = hostRestore(fd, oldState)
			oldState = nil
		}
		_ = in.SetReadDeadline(time.Time{})
	}

	enterRaw := func() bool {
		rawMu.Lock()
		defer rawMu.Unlock()
		if raw {
			return true
		}
		st, err := hostMakeRaw(fd)
		if err != nil {
			return false
		}
		oldState = st
		raw = true
		setHostRawActive(true)
		return true
	}

	// Restore TTY + unblock stopHostKeys immediately (do not wait for Read).
	finish := func() {
		leaveRaw()
		cr.Cancel()
		signalHandoff()
	}

	if !enterRaw() {
		return
	}
	defer finish()

	go func() {
		<-ctx.Done()
		finish()
	}()

	buf := make([]byte, 1)
	for {
		if ctx.Err() != nil {
			return
		}

		n, err := cr.Read(buf)
		if ctx.Err() != nil || errors.Is(err, breakread.ErrCanceled) {
			return
		}
		if n == 0 || err != nil {
			if err != nil && !os.IsTimeout(err) && err != io.EOF {
				return
			}
			continue
		}

		pin := r.peerState.GetPIN()
		if pin == "" && buf[0] != 3 {
			continue
		}

		switch buf[0] {
		case 'c':
			if pin == "" {
				continue
			}
			if err := ui.CopyToClipboard(pin); err != nil {
				fprintfHostWait(r.Stderr, text.CopyPINFailedLine, err)
			} else {
				writeHostWait(r.Stderr, text.PINCopiedLine)
			}
		case 'C':
			if pin == "" {
				continue
			}
			peerID := r.deviceState.GetPeerID()
			if peerID == "" {
				continue
			}
			link := ui.ShareURL(r.settings.GetWSURL(), peerID, pin)
			if err := ui.CopyToClipboard(link); err != nil {
				fprintfHostWait(r.Stderr, text.CopyLinkFailedLine, err)
			} else {
				writeHostWait(r.Stderr, text.ShareLinkCopiedLine)
			}
		case 3: // Ctrl+C in raw mode — confirm overlay, do not cancel yet
			leaveRaw()
			confirmed, confErr := hostConfirmExit()
			if confErr != nil || confirmed {
				if onConfirm != nil {
					onConfirm()
				}
				return
			}
			if !enterRaw() {
				return
			}
		}
	}
}

// hostCopyKeysEnabled reports whether host copy-key watching would attach to stdin.
// Used by tests for the non-TTY no-op path.
func hostCopyKeysEnabled(in *os.File) bool {
	if in == nil {
		return false
	}
	return hostIsTerminal(int(in.Fd()))
}

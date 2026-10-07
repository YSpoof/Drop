package tui

import (
	"context"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"

	"golang.org/x/term"
)

// teaOwnsSIGINT is set while a bubbletea program handles Ctrl+C itself (inbox).
// The watcher still Notify's SIGINT so the default terminate action is suppressed,
// but it does not open a second overlay.
var teaOwnsSIGINT atomic.Bool

// SetTeaOwnsSIGINT tells WatchSIGINTConfirm to drain SIGINT without showing an overlay.
func SetTeaOwnsSIGINT(v bool) {
	teaOwnsSIGINT.Store(v)
}

// WatchSIGINTConfirm listens for SIGINT while ctx is active.
// On TTY: first SIGINT shows the confirm overlay; only a confirmed exit calls cancel.
// ESC re-arms the watcher. Non-TTY: SIGINT cancels immediately.
//
// stop unregisters the signal handler; the goroutine exits when ctx is done
// or after a confirmed cancel.
func WatchSIGINTConfirm(ctx context.Context, cancel context.CancelFunc) (stop func()) {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGINT)

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ch:
				if ConfirmShowing() || teaOwnsSIGINT.Load() {
					// Overlay or bubbletea inbox owns this interrupt.
					continue
				}
				if !term.IsTerminal(int(os.Stdin.Fd())) {
					cancel()
					return
				}
				signal.Stop(ch)
				confirmed, err := RunConfirmExit()
				if err != nil || confirmed {
					cancel()
					return
				}
				// ESC: re-arm and keep waiting.
				signal.Notify(ch, syscall.SIGINT)
			}
		}
	}()

	return func() {
		signal.Stop(ch)
		// Goroutine exits on ctx.Done(); caller should cancel or end Run.
		select {
		case <-done:
		default:
		}
	}
}

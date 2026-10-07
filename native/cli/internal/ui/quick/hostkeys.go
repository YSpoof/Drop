package quick

import (
	"context"
	"io"
	"os"
	"sync"
	"time"

	"dropcli/internal/ui"
	"dropcli/internal/ui/text"
	"dropcli/internal/ui/tui"

	"golang.org/x/term"
)

// hostCopyKeys watches stdin for c/C while a host PIN is known.
// Non-TTY stdin is a no-op (returns immediately). Safe to cancel via ctx.
// onConfirm is invoked when the user confirms exit via the Ctrl+C overlay.
func (r *Runner) hostCopyKeys(ctx context.Context, onConfirm func()) {
	r.hostCopyKeysFrom(ctx, os.Stdin, onConfirm)
}

func (r *Runner) hostCopyKeysFrom(ctx context.Context, in *os.File, onConfirm func()) {
	if in == nil || !hostCopyKeysEnabled(in) {
		return
	}
	fd := int(in.Fd())

	enterRaw := func() (restore func(), ok bool) {
		oldState, err := term.MakeRaw(fd)
		if err != nil {
			return nil, false
		}
		setHostRawActive(true)
		var once sync.Once
		return func() {
			once.Do(func() {
				setHostRawActive(false)
				_ = term.Restore(fd, oldState)
			})
		}, true
	}

	restore, ok := enterRaw()
	if !ok {
		return
	}
	defer func() {
		restore()
	}()

	buf := make([]byte, 1)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		_ = in.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
		n, err := in.Read(buf)
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
			restore()
			confirmed, err := tui.RunConfirmExit()
			if err != nil || confirmed {
				if onConfirm != nil {
					onConfirm()
				}
				return
			}
			// ESC: re-enter raw and keep watching copy keys
			restore, ok = enterRaw()
			if !ok {
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
	return term.IsTerminal(int(in.Fd()))
}

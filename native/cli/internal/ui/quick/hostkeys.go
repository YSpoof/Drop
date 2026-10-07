package quick

import (
	"context"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	"dropcli/internal/ui"
	"dropcli/internal/ui/text"

	"golang.org/x/term"
)

// hostCopyKeys watches stdin for c/C while a host PIN is known.
// Non-TTY stdin is a no-op (returns immediately). Safe to cancel via ctx.
func (r *Runner) hostCopyKeys(ctx context.Context) {
	in := os.Stdin
	fd := int(in.Fd())
	if !term.IsTerminal(fd) {
		return
	}

	oldState, err := term.MakeRaw(fd)
	if err != nil {
		return
	}
	var restoreOnce sync.Once
	restore := func() {
		restoreOnce.Do(func() {
			_ = term.Restore(fd, oldState)
		})
	}
	defer restore()

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
		if pin == "" {
			continue
		}

		switch buf[0] {
		case 'c':
			if err := ui.CopyToClipboard(pin); err != nil {
				fmt.Fprintf(r.Stderr, text.CopyPINFailedLine, err)
			} else {
				fmt.Fprint(r.Stderr, text.PINCopiedLine)
			}
		case 'C':
			peerID := r.deviceState.GetPeerID()
			if peerID == "" {
				continue
			}
			link := ui.ShareURL(r.settings.GetWSURL(), peerID, pin)
			if err := ui.CopyToClipboard(link); err != nil {
				fmt.Fprintf(r.Stderr, text.CopyLinkFailedLine, err)
			} else {
				fmt.Fprint(r.Stderr, text.ShareLinkCopiedLine)
			}
		case 3: // Ctrl+C in raw mode
			restore()
			return
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

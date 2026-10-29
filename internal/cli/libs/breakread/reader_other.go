//go:build windows

package breakread

import (
	"errors"
	"os"
	"sync"
	"time"
)

// Windows: short deadlines + Cancel forces deadline expiry.
// Prefer Linux build for reliable interrupt of blocked Read.

type reader struct {
	file   *os.File
	mu     sync.Mutex
	cancel bool
	closed bool
}

// New wraps f so Read can be interrupted via Cancel.
func New(f *os.File) (Reader, error) {
	if f == nil {
		return nil, errors.New("nil file")
	}
	return &reader{file: f}, nil
}

func (r *reader) Read(p []byte) (int, error) {
	for {
		r.mu.Lock()
		if r.closed || r.cancel {
			r.mu.Unlock()
			return 0, ErrCanceled
		}
		r.mu.Unlock()

		_ = r.file.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
		n, err := r.file.Read(p)

		r.mu.Lock()
		canceled := r.cancel
		r.mu.Unlock()
		if canceled {
			_ = r.file.SetReadDeadline(time.Time{})
			return 0, ErrCanceled
		}
		if err == nil || n > 0 {
			return n, err
		}
		if os.IsTimeout(err) {
			continue
		}
		return n, err
	}
}

func (r *reader) Cancel() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.cancel {
		return false
	}
	r.cancel = true
	_ = r.file.SetReadDeadline(time.Now())
	return true
}

func (r *reader) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closed = true
	r.cancel = true
	_ = r.file.SetReadDeadline(time.Time{})
	return nil
}

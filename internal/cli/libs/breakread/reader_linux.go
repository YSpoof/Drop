//go:build linux

package breakread

import (
	"errors"
	"fmt"
	"os"
	"sync"

	"golang.org/x/sys/unix"
)

type reader struct {
	file   *os.File
	epoll  int
	sigR   *os.File
	sigW   *os.File
	mu     sync.Mutex
	closed bool
	cancel bool
}

// New wraps f so Read can be interrupted via Cancel.
func New(f *os.File) (Reader, error) {
	if f == nil {
		return nil, errors.New("nil file")
	}

	ep, err := unix.EpollCreate1(0)
	if err != nil {
		return nil, fmt.Errorf("epoll create: %w", err)
	}

	sigR, sigW, err := os.Pipe()
	if err != nil {
		_ = unix.Close(ep)
		return nil, err
	}

	r := &reader{file: f, epoll: ep, sigR: sigR, sigW: sigW}

	if err := unix.EpollCtl(ep, unix.EPOLL_CTL_ADD, int(f.Fd()), &unix.EpollEvent{
		Events: unix.EPOLLIN,
		Fd:     int32(f.Fd()),
	}); err != nil {
		_ = r.Close()
		return nil, fmt.Errorf("epoll add file: %w", err)
	}
	if err := unix.EpollCtl(ep, unix.EPOLL_CTL_ADD, int(sigR.Fd()), &unix.EpollEvent{
		Events: unix.EPOLLIN,
		Fd:     int32(sigR.Fd()),
	}); err != nil {
		_ = r.Close()
		return nil, fmt.Errorf("epoll add signal: %w", err)
	}

	return r, nil
}

func (r *reader) Read(p []byte) (int, error) {
	r.mu.Lock()
	if r.closed || r.cancel {
		r.mu.Unlock()
		return 0, ErrCanceled
	}
	r.mu.Unlock()

	if err := r.wait(); err != nil {
		return 0, err
	}

	r.mu.Lock()
	canceled := r.cancel
	r.mu.Unlock()
	if canceled {
		return 0, ErrCanceled
	}

	return r.file.Read(p)
}

func (r *reader) wait() error {
	events := make([]unix.EpollEvent, 1)
	for {
		_, err := unix.EpollWait(r.epoll, events, -1)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			return fmt.Errorf("epoll wait: %w", err)
		}
		break
	}

	switch events[0].Fd {
	case int32(r.file.Fd()):
		return nil
	case int32(r.sigR.Fd()):
		var b [1]byte
		_, _ = r.sigR.Read(b[:])
		return ErrCanceled
	default:
		return errors.New("epoll: unexpected fd")
	}
}

func (r *reader) Cancel() bool {
	r.mu.Lock()
	if r.closed || r.cancel {
		r.mu.Unlock()
		return false
	}
	r.cancel = true
	r.mu.Unlock()

	_, err := r.sigW.Write([]byte{1})
	return err == nil
}

func (r *reader) Close() error {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return nil
	}
	r.closed = true
	r.cancel = true
	r.mu.Unlock()

	_ = unix.Close(r.epoll)
	_ = r.sigW.Close()
	_ = r.sigR.Close()
	return nil
}

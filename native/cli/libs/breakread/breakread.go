//go:build linux || windows

// Package breakread provides a cancelable *os.File reader.
// Cancel unblocks an in-flight Read without consuming input (Linux: epoll + pipe).
package breakread

import "errors"

// ErrCanceled is returned from Read after Cancel.
var ErrCanceled = errors.New("read canceled")

// Reader is an io.ReadCloser with Cancel.
type Reader interface {
	Read(p []byte) (int, error)
	Cancel() bool
	Close() error
}

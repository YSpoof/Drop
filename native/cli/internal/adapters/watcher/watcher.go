package watcher

import (
	"dropcli/internal/ports"

	"github.com/fsnotify/fsnotify"
)

// Watcher implements ports.WatcherPort using fsnotify/fsnotify.
type Watcher struct {
	fsWatcher *fsnotify.Watcher
	events    chan ports.WatchEvent
	errors    chan error
	done      chan struct{}
}

// New creates and starts a new filesystem Watcher.
func New() (*Watcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	w := &Watcher{
		fsWatcher: fsw,
		events:    make(chan ports.WatchEvent, 256),
		errors:    make(chan error, 16),
		done:      make(chan struct{}),
	}

	go w.loop()

	return w, nil
}

// loop translates fsnotify events into ports.WatchEvent.
func (w *Watcher) loop() {
	defer close(w.events)
	defer close(w.errors)

	for {
		select {
		case <-w.done:
			return

		case ev, ok := <-w.fsWatcher.Events:
			if !ok {
				return
			}
			op := mapOp(ev.Op)
			if op == 0 {
				continue
			}
			select {
			case w.events <- ports.WatchEvent{Path: ev.Name, Op: op}:
			case <-w.done:
				return
			}

		case err, ok := <-w.fsWatcher.Errors:
			if !ok {
				return
			}
			select {
			case w.errors <- err:
			case <-w.done:
				return
			}
		}
	}
}

// mapOp converts fsnotify.Op to ports.WatchOp.
func mapOp(op fsnotify.Op) ports.WatchOp {
	var result ports.WatchOp
	if op.Has(fsnotify.Create) {
		result |= ports.OpCreate
	}
	if op.Has(fsnotify.Write) {
		result |= ports.OpWrite
	}
	if op.Has(fsnotify.Remove) {
		result |= ports.OpRemove
	}
	if op.Has(fsnotify.Rename) {
		result |= ports.OpRename
	}
	return result
}

// Add adds a directory path to the watch list.
func (w *Watcher) Add(path string) error {
	return w.fsWatcher.Add(path)
}

// Remove stops watching a directory path.
func (w *Watcher) Remove(path string) error {
	return w.fsWatcher.Remove(path)
}

// Events returns the channel of incoming file events.
func (w *Watcher) Events() <-chan ports.WatchEvent {
	return w.events
}

// Errors returns the channel of watcher errors.
func (w *Watcher) Errors() <-chan error {
	return w.errors
}

// Close terminates the watcher.
func (w *Watcher) Close() error {
	select {
	case <-w.done:
		// already closed
		return nil
	default:
		close(w.done)
	}
	return w.fsWatcher.Close()
}

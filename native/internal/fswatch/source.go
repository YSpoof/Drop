// Package fswatch provides a low-level filesystem event source for native apps.
package fswatch

import "github.com/fsnotify/fsnotify"

// Source wraps an fsnotify watcher without interpreting its events.
type Source struct {
	watcher *fsnotify.Watcher
}

// New creates a raw filesystem event source.
func New() (*Source, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &Source{watcher: watcher}, nil
}

// Events returns raw filesystem events.
func (s *Source) Events() <-chan fsnotify.Event {
	return s.watcher.Events
}

// Errors returns errors reported by the underlying watcher.
func (s *Source) Errors() <-chan error {
	return s.watcher.Errors
}

// Add begins watching the directory at path.
func (s *Source) Add(path string) error {
	return s.watcher.Add(path)
}

// Remove stops watching the directory at path.
func (s *Source) Remove(path string) error {
	return s.watcher.Remove(path)
}

// Close stops the watcher and closes its event and error channels.
func (s *Source) Close() error {
	return s.watcher.Close()
}

package watcher

import (
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"drop/internal/fswatch"

	"github.com/fsnotify/fsnotify"
)

const (
	settleInterval = 50 * time.Millisecond
	settleAttempts = 40
)

// Event represents a filesystem watcher event matching the TypeScript WatcherEvent contract.
type Event struct {
	Type      string `json:"type"` // "add" or "unlink"
	WatcherID string `json:"watcherId"`
	FilePath  string `json:"filePath"`
	Size      int64  `json:"size,omitempty"`
}

type activeWatcher struct {
	source *fswatch.Source
	done   chan struct{}
}

// Manager manages directory watchers keyed by watcherId.
type Manager struct {
	mu       sync.Mutex
	watchers map[string]*activeWatcher
}

func NewManager() *Manager {
	return &Manager{
		watchers: make(map[string]*activeWatcher),
	}
}

// Start begins recursively watching a folder for changes.
func (m *Manager) Start(watcherID, folderPath string, emit func(Event)) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.watchers[watcherID]; exists {
		return nil
	}

	source, err := fswatch.New()
	if err != nil {
		return fmt.Errorf("create watcher: %w", err)
	}

	// Recursively add all subdirectories
	err = filepath.WalkDir(folderPath, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			base := filepath.Base(path)
			if strings.HasPrefix(base, ".") && path != folderPath {
				return filepath.SkipDir
			}
			return source.Add(path)
		}
		return nil
	})
	if err != nil {
		_ = source.Close()
		return fmt.Errorf("walk directory: %w", err)
	}

	done := make(chan struct{})
	m.watchers[watcherID] = &activeWatcher{source: source, done: done}

	go m.loop(watcherID, source, done, emit)
	return nil
}

// Stop terminates watching for a specific watcherId.
func (m *Manager) Stop(watcherID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if aw, exists := m.watchers[watcherID]; exists {
		close(aw.done)
		delete(m.watchers, watcherID)
		return aw.source.Close()
	}
	return nil
}

// StopAll stops all active watchers.
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for id, aw := range m.watchers {
		close(aw.done)
		_ = aw.source.Close()
		delete(m.watchers, id)
	}
}

func (m *Manager) loop(watcherID string, source *fswatch.Source, done chan struct{}, emit func(Event)) {
	var settling sync.Map

	for {
		select {
		case <-done:
			return

		case err, ok := <-source.Errors():
			if !ok {
				return
			}
			log.Printf("filesystem watcher error: %v", err)

		case ev, ok := <-source.Events():
			if !ok {
				return
			}

			baseName := filepath.Base(ev.Name)
			if strings.HasPrefix(baseName, ".") {
				continue
			}

			if ev.Has(fsnotify.Remove) || ev.Has(fsnotify.Rename) {
				emit(Event{
					Type:      "unlink",
					WatcherID: watcherID,
					FilePath:  ev.Name,
				})
				continue
			}

			if ev.Has(fsnotify.Create) || ev.Has(fsnotify.Write) {
				stat, err := os.Stat(ev.Name)
				if err != nil {
					continue
				}

				if stat.IsDir() {
					if ev.Has(fsnotify.Create) {
						if err := source.Add(ev.Name); err != nil {
							log.Printf("add directory to filesystem watcher: %v", err)
						}
					}
					continue
				}

				// File creation or update: run settlement
				if _, active := settling.LoadOrStore(ev.Name, struct{}{}); active {
					continue
				}

				go func(filePath string) {
					defer settling.Delete(filePath)
					size, ok := settleFileSize(filePath, done)
					if ok {
						emit(Event{
							Type:      "add",
							WatcherID: watcherID,
							FilePath:  filePath,
							Size:      size,
						})
					}
				}(ev.Name)
			}
		}
	}
}

// settleFileSize repeatedly checks the file size until it stops growing.
func settleFileSize(path string, done chan struct{}) (int64, bool) {
	var previous int64 = -1

	for range settleAttempts {
		select {
		case <-done:
			return 0, false
		case <-time.After(settleInterval):
		}

		info, err := os.Stat(path)
		if err != nil || info.IsDir() {
			return 0, false
		}

		current := info.Size()
		if current == previous {
			return current, true
		}
		previous = current
	}

	if previous >= 0 {
		return previous, true
	}
	return 0, false
}

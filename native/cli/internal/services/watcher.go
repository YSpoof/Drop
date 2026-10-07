package services

import (
	"os"
	"path/filepath"
	"strings"
	"sync"

	"dropcli/internal/ports"
)

// FolderWatcherService detects added and modified files in a target directory
// and queues them for announcement to connected peers.
type FolderWatcherService struct {
	mu          sync.Mutex
	watcher     ports.WatcherPort
	repo        ports.FileRepository
	roots       []string
	loopStarted bool
	queue       []string
	queueCh     chan struct{} // signals new items
	done        chan struct{}
	closed      bool
	visited     map[string]struct{}
}

// NewFolderWatcherService creates a new FolderWatcherService.
func NewFolderWatcherService(watcher ports.WatcherPort, repo ports.FileRepository) *FolderWatcherService {
	return &FolderWatcherService{
		watcher: watcher,
		repo:    repo,
		queue:   make([]string, 0),
		queueCh: make(chan struct{}, 1),
		done:    make(chan struct{}),
		visited: make(map[string]struct{}),
	}
}

// Watch starts recursively monitoring the given directory tree for new and modified files.
// May be called multiple times to watch additional roots; the event loop starts once.
func (s *FolderWatcherService) Watch(dir string) error {
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return err
	}

	if err := s.repo.EnsureDir(absDir); err != nil {
		return err
	}

	if err := s.addTree(absDir); err != nil {
		return err
	}

	s.mu.Lock()
	s.roots = append(s.roots, absDir)
	startLoop := !s.loopStarted
	if startLoop {
		s.loopStarted = true
	}
	s.mu.Unlock()

	if startLoop {
		go s.loop()
	}
	return nil
}

// Dir returns the first absolute watch root, or empty if none.
func (s *FolderWatcherService) Dir() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.roots) == 0 {
		return ""
	}
	return s.roots[0]
}

// AnnounceName returns the Drop-compatible meta.name for a queued absolute path.
func (s *FolderWatcherService) AnnounceName(absPath string) string {
	s.mu.Lock()
	root := s.rootForLocked(absPath)
	s.mu.Unlock()
	return AnnounceNameForPath(absPath, root)
}

// rootForLocked picks the longest matching watch root for absPath. Caller holds s.mu.
func (s *FolderWatcherService) rootForLocked(absPath string) string {
	abs, err := filepath.Abs(absPath)
	if err != nil {
		abs = absPath
	}
	best := ""
	bestLen := -1
	sep := string(filepath.Separator)
	for _, root := range s.roots {
		if abs == root || strings.HasPrefix(abs, root+sep) {
			if len(root) > bestLen {
				best = root
				bestLen = len(root)
			}
		}
	}
	return best
}

// addTree walks dir and Adds every directory, skipping symlink cycles via visited set.
func (s *FolderWatcherService) addTree(root string) error {
	return filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			return nil
		}
		abs, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		// Resolve symlinks for cycle detection; still Add the path fsnotify sees.
		real, err := filepath.EvalSymlinks(abs)
		if err != nil {
			real = abs
		}
		s.mu.Lock()
		if _, seen := s.visited[real]; seen {
			s.mu.Unlock()
			return filepath.SkipDir
		}
		s.visited[real] = struct{}{}
		s.mu.Unlock()

		return s.watcher.Add(abs)
	})
}

// loop reads watcher events and enqueues file paths.
func (s *FolderWatcherService) loop() {
	events := s.watcher.Events()
	errors := s.watcher.Errors()

	for {
		select {
		case <-s.done:
			return
		case ev, ok := <-events:
			if !ok {
				return
			}
			if ev.Op&(ports.OpCreate|ports.OpWrite) == 0 {
				continue
			}
			info, err := os.Stat(ev.Path)
			if err != nil {
				continue
			}
			if info.IsDir() {
				if ev.Op&ports.OpCreate != 0 {
					_ = s.addTree(ev.Path)
				}
				continue
			}
			s.enqueue(ev.Path)
		case _, ok := <-errors:
			if !ok {
				return
			}
			// Watcher errors are silently consumed to prevent blocking.
		}
	}
}

// enqueue adds a file path to the announcement queue, deduplicating consecutive entries.
func (s *FolderWatcherService) enqueue(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.queue) > 0 && s.queue[len(s.queue)-1] == path {
		return
	}
	s.queue = append(s.queue, path)

	select {
	case s.queueCh <- struct{}{}:
	default:
	}
}

// Dequeue removes and returns the next file path from the queue.
// Returns an empty string and false if the queue is empty.
func (s *FolderWatcherService) Dequeue() (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.queue) == 0 {
		return "", false
	}
	path := s.queue[0]
	s.queue = s.queue[1:]
	return path, true
}

// DequeueAll removes and returns all queued file paths.
func (s *FolderWatcherService) DequeueAll() []string {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(s.queue) == 0 {
		return nil
	}
	result := s.queue
	s.queue = make([]string, 0)
	return result
}

// QueueLen returns the number of queued file paths.
func (s *FolderWatcherService) QueueLen() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.queue)
}

// Notify returns a channel that is signaled when new items are available.
func (s *FolderWatcherService) Notify() <-chan struct{} {
	return s.queueCh
}

// Close stops the folder watcher service and underlying watcher.
func (s *FolderWatcherService) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return nil
	}
	s.closed = true
	close(s.done)
	return s.watcher.Close()
}

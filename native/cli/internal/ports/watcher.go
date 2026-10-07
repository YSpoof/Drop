package ports

// WatchOp defines filesystem event operation types.
type WatchOp int

const (
	OpCreate WatchOp = 1 << iota
	OpWrite
	OpRemove
	OpRename
)

// WatchEvent represents a filesystem event on a watched path.
type WatchEvent struct {
	Path string
	Op   WatchOp
}

// WatcherPort defines the interface for monitoring directory changes.
type WatcherPort interface {
	// Add adds a directory path to the watch list.
	Add(path string) error

	// Remove stops watching a directory path.
	Remove(path string) error

	// Events returns the channel of incoming file events.
	Events() <-chan WatchEvent

	// Errors returns the channel of watcher errors.
	Errors() <-chan error

	// Close terminates the watcher.
	Close() error
}

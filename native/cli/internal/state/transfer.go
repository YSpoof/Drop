package state

import (
	"sync"
	"time"
)

// TransferDirection specifies whether a transfer is incoming or outgoing.
type TransferDirection string

const (
	DirectionSend    TransferDirection = "send"
	DirectionReceive TransferDirection = "receive"
)

// TransferStatus describes the progress of an individual file transfer.
type TransferStatus string

const (
	TransferPending   TransferStatus = "pending"
	TransferActive    TransferStatus = "active"
	TransferCompleted TransferStatus = "completed"
	TransferCancelled TransferStatus = "cancelled"
	TransferFailed    TransferStatus = "failed"
)

// FileTransfer tracks state and progress of an individual file.
type FileTransfer struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Size             int64             `json:"size"`
	Mime             string            `json:"mime"`
	Direction        TransferDirection `json:"direction"`
	Status           TransferStatus    `json:"status"`
	TransferredBytes int64             `json:"transferredBytes"`
	Speed            float64           `json:"speed"` // bytes per second
	LocalPath        string            `json:"localPath"`
	StartTime        time.Time         `json:"startTime"`
	EndTime          time.Time         `json:"endTime"`
	Error            string            `json:"error,omitempty"`
}

// TransferState manages the list of all file transfers for the active session.
// It also tracks lifetime transfer statistics that are persisted across sessions.
type TransferState struct {
	mu        sync.RWMutex
	transfers map[string]*FileTransfer
	order     []string
	stats     TransferStats
}

// NewTransferState creates a new TransferState.
// It loads initial lifetime totals from the persisted config if available.
func NewTransferState() *TransferState {
	stats := LoadTransferStatsFromConfig()
	return &TransferState{
		transfers: make(map[string]*FileTransfer),
		order:     make([]string, 0),
		stats:     stats,
	}
}

// LoadTransferStatsFromConfig reads transfer statistics from ~/.dropConfig.
// Returns zero values if the config file is missing or corrupt.
func LoadTransferStatsFromConfig() TransferStats {
	store, err := NewStore()
	if err != nil {
		return TransferStats{}
	}

	cfg, err := store.Load()
	if err != nil || cfg == nil {
		return TransferStats{}
	}

	return cfg.TransferStats
}

// AddTransfer adds or updates a file transfer entry.
func (ts *TransferState) AddTransfer(t *FileTransfer) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if _, exists := ts.transfers[t.ID]; !exists {
		ts.order = append(ts.order, t.ID)
	}
	ts.transfers[t.ID] = t
}

// GetTransfer returns a pointer copy of a transfer if found.
func (ts *TransferState) GetTransfer(id string) (*FileTransfer, bool) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	t, exists := ts.transfers[id]
	if !exists {
		return nil, false
	}
	cpy := *t
	return &cpy, true
}

// UpdateProgress updates the bytes transferred and computes speed.
func (ts *TransferState) UpdateProgress(id string, transferred int64, speed float64) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if t, exists := ts.transfers[id]; exists {
		t.TransferredBytes = transferred
		t.Speed = speed
		if t.Status == TransferPending {
			t.Status = TransferActive
			t.StartTime = time.Now()
		}
	}
}

// SetStatus updates status for a transfer item.
func (ts *TransferState) SetStatus(id string, status TransferStatus, errStr ...string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if t, exists := ts.transfers[id]; exists {
		t.Status = status
		if status == TransferCompleted || status == TransferCancelled || status == TransferFailed {
			t.EndTime = time.Now()
		}
		if len(errStr) > 0 {
			t.Error = errStr[0]
		}
	}
}

// InterruptReceives marks pending/active receive transfers as failed (peer-loss abort).
// Incomplete .drop files on disk are left untouched for resume.
func (ts *TransferState) InterruptReceives(reason string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	now := time.Now()
	for _, t := range ts.transfers {
		if t.Direction != DirectionReceive {
			continue
		}
		if t.Status != TransferPending && t.Status != TransferActive {
			continue
		}
		t.Status = TransferFailed
		t.Error = reason
		t.EndTime = now
		t.Speed = 0
	}
}

// GetAll returns all transfers in chronological order.
func (ts *TransferState) GetAll() []FileTransfer {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	result := make([]FileTransfer, 0, len(ts.order))
	for _, id := range ts.order {
		if t, exists := ts.transfers[id]; exists {
			result = append(result, *t)
		}
	}
	return result
}

// GetActive returns the currently active transfer if any.
func (ts *TransferState) GetActive() (*FileTransfer, bool) {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	for _, id := range ts.order {
		if t, exists := ts.transfers[id]; exists && t.Status == TransferActive {
			cpy := *t
			return &cpy, true
		}
	}
	return nil, false
}

// AllCompleted returns true if all transfers are completed or cancelled/failed.
func (ts *TransferState) AllCompleted() bool {
	ts.mu.RLock()
	defer ts.mu.RUnlock()

	if len(ts.transfers) == 0 {
		return true
	}

	for _, t := range ts.transfers {
		if t.Status == TransferPending || t.Status == TransferActive {
			return false
		}
	}
	return true
}

// GetStats returns a copy of the current transfer statistics.
func (ts *TransferState) GetStats() TransferStats {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return ts.stats
}

// AddStats adds the given transfer to the lifetime statistics.
func (ts *TransferState) AddStats(direction TransferDirection, bytes int64) {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if direction == DirectionSend {
		ts.stats.UploadBytes += bytes
		ts.stats.UploadFiles++
	} else {
		ts.stats.DownloadBytes += bytes
		ts.stats.DownloadFiles++
	}
}

// ResetStats zeroes out the lifetime transfer statistics.
func (ts *TransferState) ResetStats() {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	ts.stats = TransferStats{}
}

// FlushStats persists the current lifetime transfer statistics to the config file.
func (ts *TransferState) FlushStats() error {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	return nil // Persistence is handled by Settings.ResetStats/Settings.FlushStats
}
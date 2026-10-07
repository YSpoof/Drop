package services

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"sync"
	"time"

	"dropcli/internal/ports"
	"dropcli/internal/state"
	"dropcli/internal/ui/text"
	"dropcli/internal/webrtc"
)

type PendingOffer struct {
	FileID string
	Name   string
	Size   int64
	Mime   string
}

// DownloadService coordinates receiving file streams, writing chunks to disk,
// calculating resume offsets, and emitting credit/ack flow control messages.
type DownloadService struct {
	mu            sync.Mutex
	repo          ports.FileRepository
	transferState *state.TransferState
	settings      *state.Settings

	emitCredit func(fileID string, bytes int64) error
	emitAck    func(fileID string) error

	pending      map[string]webrtc.MetaMessage
	pendingOrder []string
	awaiting     map[string]webrtc.MetaMessage

	activeFileID    string
	activeWriter    io.WriteCloser
	activeMeta      *webrtc.MetaMessage
	activeHash      string
	resumeOffset    int64
	bytesReceived   int64
	uncreditedBytes int64
	lastProgressAt  time.Time

	onComplete      func(name string, size int64)
	onPendingChange func()
}

// NewDownloadService creates a new concrete DownloadService.
func NewDownloadService(repo ports.FileRepository, ts *state.TransferState, s *state.Settings) *DownloadService {
	return &DownloadService{
		repo:          repo,
		transferState: ts,
		settings:      s,
		pending:       make(map[string]webrtc.MetaMessage),
		awaiting:      make(map[string]webrtc.MetaMessage),
	}
}

// SetEmitCredit sets the callback for sending credit control messages over the ctrl channel.
// The bytes argument is the absolute accepted offset (Drop BytesWritten), not a delta.
func (d *DownloadService) SetEmitCredit(fn func(fileID string, bytes int64) error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.emitCredit = fn
}

// SetEmitAck sets the callback for sending ack control messages over the ctrl channel.
func (d *DownloadService) SetEmitAck(fn func(fileID string) error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.emitAck = fn
}

// SetOnComplete sets callback invoked after a file is fully received and acked.
func (d *DownloadService) SetOnComplete(fn func(name string, size int64)) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.onComplete = fn
}

// SetOnPendingChange sets callback invoked when the pending-offer list changes.
func (d *DownloadService) SetOnPendingChange(fn func()) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.onPendingChange = fn
}

// ResumeOffset returns the resume offset computed for the active file from meta.
func (d *DownloadService) ResumeOffset() int64 {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.resumeOffset
}

// ResumeHash returns the Drop identity hash used for the active receive.
func (d *DownloadService) ResumeHash() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.activeHash
}

func (d *DownloadService) isManual() bool {
	return d.settings != nil && !d.settings.GetAutoDownload()
}

// PendingOffers returns a snapshot of announced files waiting for pull or dismiss.
func (d *DownloadService) PendingOffers() []PendingOffer {
	d.mu.Lock()
	defer d.mu.Unlock()

	out := make([]PendingOffer, 0, len(d.pendingOrder))
	for _, id := range d.pendingOrder {
		meta, ok := d.pending[id]
		if !ok {
			continue
		}
		out = append(out, PendingOffer{
			FileID: meta.FileID,
			Name:   meta.Name,
			Size:   meta.Size,
			Mime:   meta.Mime,
		})
	}
	return out
}

func (d *DownloadService) removePendingLocked(fileID string) {
	delete(d.pending, fileID)
	for i, id := range d.pendingOrder {
		if id == fileID {
			d.pendingOrder = append(d.pendingOrder[:i], d.pendingOrder[i+1:]...)
			return
		}
	}
}

func (d *DownloadService) identityHash(meta webrtc.MetaMessage) string {
	if meta.Hash != "" {
		return meta.Hash
	}
	return ephemeralDropHash()
}

func (d *DownloadService) dropResumeOffset(meta webrtc.MetaMessage) (int64, error) {
	hash := meta.Hash
	if hash == "" {
		return 0, nil
	}
	destDir := d.settings.GetDownloadDir()
	return d.repo.GetDropResumeOffset(destDir, hash, meta.Size)
}

// HandleMeta processes an incoming file announcement and determines the resume offset.
// In manual mode, the offer is held pending until PreparePull; writers are not opened.
func (d *DownloadService) HandleMeta(meta webrtc.MetaMessage) (int64, error) {
	d.mu.Lock()

	resumeOffset, err := d.dropResumeOffset(meta)
	if err != nil {
		d.mu.Unlock()
		return 0, fmt.Errorf("failed to check drop resume offset: %w", err)
	}

	transferItem := &state.FileTransfer{
		ID:               meta.FileID,
		Name:             meta.Name,
		Size:             meta.Size,
		Mime:             meta.Mime,
		Hash:             meta.Hash,
		Direction:        state.DirectionReceive,
		Status:           state.TransferPending,
		TransferredBytes: resumeOffset,
		LocalPath:        d.settings.GetDownloadDir(),
	}
	d.transferState.AddTransfer(transferItem)

	if d.isManual() {
		if _, exists := d.pending[meta.FileID]; !exists {
			d.pendingOrder = append(d.pendingOrder, meta.FileID)
		}
		d.pending[meta.FileID] = meta
		cb := d.onPendingChange
		d.mu.Unlock()
		notifyPendingChange(cb)
		return resumeOffset, nil
	}

	// Auto mode: keep every announced meta awaiting start. Do not overwrite a
	// single activeMeta — Drop may announce a whole batch before any start.
	d.awaiting[meta.FileID] = meta
	d.mu.Unlock()

	return resumeOffset, nil
}

// IsManual reports whether local receive mode requires pull before start.
func (d *DownloadService) IsManual() bool {
	return d.isManual()
}

// PreparePull moves a pending offer into awaiting-start so HandleStart can accept it.
func (d *DownloadService) PreparePull(fileID string) error {
	d.mu.Lock()
	meta, ok := d.pending[fileID]
	if !ok {
		d.mu.Unlock()
		return fmt.Errorf("no pending offer for fileId: %s", fileID)
	}
	d.removePendingLocked(fileID)
	d.awaiting[fileID] = meta

	resumeOffset, err := d.dropResumeOffset(meta)
	if err != nil {
		d.mu.Unlock()
		return fmt.Errorf("failed to check drop resume offset: %w", err)
	}
	d.resumeOffset = resumeOffset
	cb := d.onPendingChange
	d.mu.Unlock()

	notifyPendingChange(cb)
	return nil
}

// DismissPending clears a pending offer locally without downloading.
func (d *DownloadService) DismissPending(fileID string) error {
	d.mu.Lock()
	var meta webrtc.MetaMessage
	var found bool
	if m, ok := d.pending[fileID]; ok {
		meta = m
		found = true
		d.removePendingLocked(fileID)
	} else if m, awaiting := d.awaiting[fileID]; awaiting {
		meta = m
		found = true
		delete(d.awaiting, fileID)
	}
	if !found {
		d.mu.Unlock()
		return fmt.Errorf("no pending offer for fileId: %s", fileID)
	}

	if meta.Hash != "" {
		_ = d.repo.DropIncomplete(d.settings.GetDownloadDir(), meta.Hash)
	}

	d.transferState.SetStatus(fileID, state.TransferCancelled, "dismissed")
	cb := d.onPendingChange
	d.mu.Unlock()

	notifyPendingChange(cb)
	return nil
}

// DropIncomplete discards one identity's .drop, or all *.drop when hash is empty.
func (d *DownloadService) DropIncomplete(hash string) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.settings == nil {
		return nil
	}
	return d.repo.DropIncomplete(d.settings.GetDownloadDir(), hash)
}

// AbortKeepPartials closes active writers without deleting incomplete .drop files.
func (d *DownloadService) AbortKeepPartials() {
	d.mu.Lock()
	if d.activeWriter != nil {
		_ = d.activeWriter.Close()
		d.activeWriter = nil
	}
	d.activeFileID = ""
	d.activeMeta = nil
	d.activeHash = ""
	d.resumeOffset = 0
	d.bytesReceived = 0
	d.uncreditedBytes = 0
	clear(d.awaiting)
	clear(d.pending)
	d.pendingOrder = nil
	ts := d.transferState
	cb := d.onPendingChange
	d.mu.Unlock()

	if ts != nil {
		ts.InterruptReceives(text.PeerLost)
	}
	notifyPendingChange(cb)
}

// notifyPendingChange runs the UI callback off the caller stack so Bubble Tea
// Update → action → p.Send cannot deadlock.
func notifyPendingChange(cb func()) {
	if cb == nil {
		return
	}
	go cb()
}

func alignOffset(offset int64, chunkSize uint32) int64 {
	if offset <= 0 || chunkSize == 0 {
		return 0
	}
	return offset - (offset % int64(chunkSize))
}

func ephemeralDropHash() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return "ephemeral|" + hex.EncodeToString(b)
}

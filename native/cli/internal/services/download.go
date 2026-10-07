package services

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"dropcli/internal/ports"
	"dropcli/internal/state"
	"dropcli/internal/webrtc"
)

// PendingOffer is a remote file announced via meta and waiting for pull or dismiss.
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
		return 0, nil
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
		ts.InterruptReceives("peer lost")
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

// HandleStart initializes disk writing for the transfer.
func (d *DownloadService) HandleStart(start webrtc.StartMessage) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.activeMeta == nil || d.activeMeta.FileID != start.FileID {
		if meta, ok := d.awaiting[start.FileID]; ok {
			delete(d.awaiting, start.FileID)
			d.activeMeta = &meta
			d.activeFileID = meta.FileID
			d.activeHash = d.identityHash(meta)

			rawOffset, err := d.dropResumeOffset(meta)
			if err != nil {
				return fmt.Errorf("failed to check drop resume offset: %w", err)
			}
			d.resumeOffset = alignOffset(rawOffset, start.ChunkSize)
		} else {
			return fmt.Errorf("start message for unexpected fileId: %s", start.FileID)
		}
	} else if d.activeHash == "" {
		d.activeHash = d.identityHash(*d.activeMeta)
	}

	offset := start.Offset
	if d.resumeOffset > offset {
		offset = d.resumeOffset
	}
	offset = alignOffset(offset, start.ChunkSize)
	d.resumeOffset = offset

	destDir := d.settings.GetDownloadDir()
	writer, err := d.repo.CreateDropWrite(destDir, d.activeHash, offset)
	if err != nil {
		d.transferState.SetStatus(start.FileID, state.TransferFailed, err.Error())
		return fmt.Errorf("failed to create drop writer: %w", err)
	}

	d.activeWriter = writer
	d.bytesReceived = offset
	d.uncreditedBytes = 0
	d.lastProgressAt = time.Now()

	d.transferState.SetStatus(start.FileID, state.TransferActive)
	d.transferState.UpdateProgress(start.FileID, offset, 0)

	return nil
}

// HandleChunk writes an incoming binary chunk to disk and emits credits every 1 MiB.
func (d *DownloadService) HandleChunk(data []byte) error {
	d.mu.Lock()
	if d.activeWriter == nil {
		deadline := time.Now().Add(1 * time.Second)
		for d.activeWriter == nil && time.Now().Before(deadline) {
			d.mu.Unlock()
			time.Sleep(5 * time.Millisecond)
			d.mu.Lock()
		}
		if d.activeWriter == nil {
			d.mu.Unlock()
			return errors.New("no active download writer")
		}
	}
	defer d.mu.Unlock()

	n, err := d.activeWriter.Write(data)
	if err != nil {
		d.transferState.SetStatus(d.activeFileID, state.TransferFailed, err.Error())
		return fmt.Errorf("failed to write chunk to disk: %w", err)
	}

	chunkLen := int64(n)
	d.bytesReceived += chunkLen
	d.uncreditedBytes += chunkLen

	// Update transfer progress
	now := time.Now()
	elapsed := now.Sub(d.lastProgressAt).Seconds()
	var speed float64
	if elapsed > 0 {
		speed = float64(chunkLen) / elapsed
	}
	d.lastProgressAt = now
	d.transferState.UpdateProgress(d.activeFileID, d.bytesReceived, speed)

	// Emit flow control credit if threshold reached (absolute accepted offset).
	if d.uncreditedBytes >= webrtc.CreditBatchSize {
		d.uncreditedBytes = 0
		if d.emitCredit != nil {
			if err := d.emitCredit(d.activeFileID, d.bytesReceived); err != nil {
				return fmt.Errorf("failed to emit credit: %w", err)
			}
		}
	}

	return nil
}

// HandleDone finalizes the download, flushes credits, verifies length, and emits ack.
func (d *DownloadService) HandleDone(done webrtc.DoneMessage) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.activeFileID != done.FileID || d.activeWriter == nil {
		return fmt.Errorf("done message received for invalid active file: %s", done.FileID)
	}

	// Wait up to 5 seconds if in-flight chunks on the files channel are still arriving
	if d.activeMeta != nil && d.bytesReceived < d.activeMeta.Size {
		deadline := time.Now().Add(5 * time.Second)
		for d.bytesReceived < d.activeMeta.Size && time.Now().Before(deadline) {
			d.mu.Unlock()
			time.Sleep(5 * time.Millisecond)
			d.mu.Lock()
		}
	}

	if err := d.activeWriter.Close(); err != nil {
		d.transferState.SetStatus(done.FileID, state.TransferFailed, err.Error())
		return fmt.Errorf("failed to close writer: %w", err)
	}
	d.activeWriter = nil

	// Flush remaining uncredited bytes as absolute offset
	if d.uncreditedBytes > 0 && d.emitCredit != nil {
		_ = d.emitCredit(d.activeFileID, d.bytesReceived)
		d.uncreditedBytes = 0
	}

	// Verify file size
	if d.activeMeta != nil && d.bytesReceived != d.activeMeta.Size {
		err := fmt.Errorf("size mismatch: expected %d bytes, got %d", d.activeMeta.Size, d.bytesReceived)
		d.transferState.SetStatus(done.FileID, state.TransferFailed, err.Error())
		return err
	}

	finalName := ""
	size := d.bytesReceived
	if d.activeMeta != nil {
		finalName = d.activeMeta.Name
		size = d.activeMeta.Size
	}
	destDir := d.settings.GetDownloadDir()
	chosen, err := d.repo.FinalizeDrop(destDir, d.activeHash, finalName)
	if err != nil {
		d.transferState.SetStatus(done.FileID, state.TransferFailed, err.Error())
		return fmt.Errorf("failed to finalize drop: %w", err)
	}

	d.transferState.SetStatus(done.FileID, state.TransferCompleted)
	d.transferState.AddStats(state.DirectionReceive, d.bytesReceived)

	onComplete := d.onComplete

	if d.emitAck != nil {
		if err := d.emitAck(done.FileID); err != nil {
			return fmt.Errorf("failed to emit ack: %w", err)
		}
	}

	d.activeFileID = ""
	d.activeMeta = nil
	d.activeHash = ""
	d.resumeOffset = 0

	if onComplete != nil && chosen != "" {
		onComplete(chosen, size)
	}

	return nil
}

// HandleCancel cancels the active download and discards its .drop partial.
func (d *DownloadService) HandleCancel(cancel webrtc.CancelMessage) {
	d.mu.Lock()

	hash := ""
	if d.activeMeta != nil && d.activeMeta.FileID == cancel.FileID {
		hash = d.activeHash
		if hash == "" {
			hash = d.activeMeta.Hash
		}
	} else if meta, ok := d.pending[cancel.FileID]; ok {
		hash = meta.Hash
	} else if meta, ok := d.awaiting[cancel.FileID]; ok {
		hash = meta.Hash
	}

	if d.activeWriter != nil && d.activeFileID == cancel.FileID {
		_ = d.activeWriter.Close()
		d.activeWriter = nil
	}

	d.removePendingLocked(cancel.FileID)
	delete(d.awaiting, cancel.FileID)

	if hash != "" {
		_ = d.repo.DropIncomplete(d.settings.GetDownloadDir(), hash)
	}

	d.transferState.SetStatus(cancel.FileID, state.TransferCancelled, cancel.Reason)
	if d.activeFileID == cancel.FileID {
		d.activeFileID = ""
		d.activeMeta = nil
		d.activeHash = ""
	}
	cb := d.onPendingChange
	d.mu.Unlock()

	notifyPendingChange(cb)
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

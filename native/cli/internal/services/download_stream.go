package services

import (
	"errors"
	"fmt"
	"time"

	"dropcli/internal/state"
	"dropcli/internal/webrtc"
)

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

package services

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"time"

	"dropcli/internal/state"
	"dropcli/internal/ui/text"
	"dropcli/internal/webrtc"
)

func (s *TransferService) SendFile(ctx context.Context, filePath string) error {
	return s.SendFileNamed(ctx, filePath, filepath.Base(filePath))
}

// SendFileNamed announces and streams a file using the given Drop announce name.
func (s *TransferService) SendFileNamed(ctx context.Context, filePath, announceName string) error {
	if announceName == "" {
		announceName = filepath.Base(filePath)
	}
	info, err := s.repo.Stat(filePath)
	if err != nil {
		return fmt.Errorf("failed to stat file %s: %w", filePath, err)
	}

	fileID := generateID()
	identity := webrtc.FileIdentity(announceName, info.Size, info.MtimeMs)
	entry := SendQueueEntry{LocalPath: filePath, AnnounceName: announceName}

	s.mu.Lock()
	ackCh := make(chan struct{}, 1)
	resumeCh := make(chan int64, 1)
	pullCh := make(chan struct{}, 1)
	dlAbortCh := make(chan struct{}, 1)
	s.activeAckChans[fileID] = ackCh
	s.activeResumeChans[fileID] = resumeCh
	s.activeSendHashes[fileID] = identity
	s.pullWaiters[fileID] = pullCh
	s.dlAbortWaiters[fileID] = dlAbortCh
	s.creditConfirmed = 0
	s.bytesInFlight = 0
	s.sendingEntry = entry
	manual := s.remoteManual
	chunkSize := s.chunkSize
	sendDataFn := s.sendData
	peerAbort := s.peerAbort
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.activeAckChans, fileID)
		delete(s.activeResumeChans, fileID)
		delete(s.activeSendHashes, fileID)
		delete(s.pullWaiters, fileID)
		delete(s.dlAbortWaiters, fileID)
		if s.sendingEntry.LocalPath == filePath {
			s.sendingEntry = SendQueueEntry{}
		}
		s.creditConfirmed = 0
		s.mu.Unlock()
	}()

	if sendDataFn == nil {
		return errors.New("data transport not configured")
	}

	transferItem := &state.FileTransfer{
		ID:               fileID,
		Name:             announceName,
		Size:             info.Size,
		Hash:             identity,
		Direction:        state.DirectionSend,
		Status:           state.TransferPending,
		LocalPath:        filePath,
		TransferredBytes: 0,
	}
	s.transferState.AddTransfer(transferItem)

	meta := webrtc.MetaMessage{
		Type:   webrtc.CtrlMeta,
		FileID: fileID,
		Name:   announceName,
		Size:   info.Size,
		Mime:   "application/octet-stream",
		Hash:   identity,
	}
	if err := s.SendControl(meta); err != nil {
		s.transferState.SetStatus(fileID, state.TransferFailed, err.Error())
		return fmt.Errorf("failed to send meta message: %w", err)
	}

	needPull := manual
	for {
		if needPull {
			if err := s.waitForPull(ctx, fileID, pullCh, dlAbortCh, peerAbort); err != nil {
				if errors.Is(err, ErrDownloadAborted) {
					s.transferState.SetStatus(fileID, state.TransferPending, "download aborted")
					s.transferState.UpdateProgress(fileID, 0, 0)
					needPull = true
					continue
				}
				return err
			}
		}

		err := s.sendBinary(ctx, fileID, filePath, info.Size, chunkSize, sendDataFn, ackCh, resumeCh, dlAbortCh, peerAbort, transferItem)
		if errors.Is(err, ErrDownloadAborted) {
			s.transferState.SetStatus(fileID, state.TransferPending, "download aborted")
			s.transferState.UpdateProgress(fileID, 0, 0)
			s.mu.Lock()
			s.bytesInFlight = 0
			s.creditConfirmed = 0
			s.cond.Broadcast()
			s.mu.Unlock()
			needPull = true
			continue
		}
		return err
	}
}

func (s *TransferService) waitForPull(
	ctx context.Context,
	fileID string,
	pullCh <-chan struct{},
	dlAbortCh <-chan struct{},
	peerAbort <-chan struct{},
) error {
	s.transferState.SetStatus(fileID, state.TransferPending)
	for {
		select {
		case <-pullCh:
			return nil
		case <-dlAbortCh:
			return ErrDownloadAborted
		case <-peerAbort:
			s.transferState.SetStatus(fileID, state.TransferPending, text.PeerLost)
			return ErrPeerAbort
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (s *TransferService) sendBinary(
	ctx context.Context,
	fileID, filePath string,
	size int64,
	chunkSize uint32,
	sendDataFn func([]byte) error,
	ackCh <-chan struct{},
	resumeCh <-chan int64,
	dlAbortCh <-chan struct{},
	peerAbort <-chan struct{},
	transferItem *state.FileTransfer,
) error {
	start := webrtc.StartMessage{
		Type:      webrtc.CtrlStart,
		FileID:    fileID,
		ChunkSize: chunkSize,
		Offset:    0,
	}
	if err := s.SendControl(start); err != nil {
		s.transferState.SetStatus(fileID, state.TransferFailed, err.Error())
		return fmt.Errorf("failed to send start message: %w", err)
	}

	var offset int64
	select {
	case resOffset := <-resumeCh:
		if resOffset > 0 && resOffset < size {
			offset = resOffset
		}
	case <-dlAbortCh:
		return ErrDownloadAborted
	case <-peerAbort:
		s.transferState.SetStatus(fileID, state.TransferPending, text.PeerLost)
		return ErrPeerAbort
	case <-time.After(30 * time.Second):
		offset = 0
	case <-ctx.Done():
		return ctx.Err()
	}

	s.mu.Lock()
	s.creditConfirmed = offset
	s.mu.Unlock()
	s.transferState.SetStatus(fileID, state.TransferActive)
	s.transferState.UpdateProgress(fileID, offset, 0)

	reader, _, err := s.repo.OpenRead(filePath, offset)
	if err != nil {
		s.transferState.SetStatus(fileID, state.TransferFailed, err.Error())
		return fmt.Errorf("failed to open file for streaming: %w", err)
	}
	defer reader.Close()

	buf := make([]byte, chunkSize)
	sentBytes := offset
	lastProgressAt := time.Now()

	for {
		select {
		case <-ctx.Done():
			_ = s.SendControl(webrtc.CancelMessage{Type: webrtc.CtrlCancel, FileID: fileID, Reason: "context cancelled"})
			s.transferState.SetStatus(fileID, state.TransferCancelled, "context cancelled")
			return ctx.Err()
		case <-dlAbortCh:
			return ErrDownloadAborted
		case <-peerAbort:
			s.transferState.SetStatus(fileID, state.TransferPending, text.PeerLost)
			return ErrPeerAbort
		default:
		}

		n, readErr := reader.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])

			s.mu.Lock()
			for s.bytesInFlight+int64(n) > webrtc.SendWindowSize {
				s.cond.Wait()
				select {
				case <-ctx.Done():
					s.mu.Unlock()
					return ctx.Err()
				case <-dlAbortCh:
					s.mu.Unlock()
					return ErrDownloadAborted
				case <-peerAbort:
					s.mu.Unlock()
					s.transferState.SetStatus(fileID, state.TransferPending, text.PeerLost)
					return ErrPeerAbort
				default:
				}
			}
			s.bytesInFlight += int64(n)
			s.mu.Unlock()

			if err := sendDataFn(chunk); err != nil {
				s.transferState.SetStatus(fileID, state.TransferFailed, err.Error())
				return fmt.Errorf("failed to send data chunk: %w", err)
			}

			sentBytes += int64(n)
			now := time.Now()
			elapsed := now.Sub(lastProgressAt).Seconds()
			var speed float64
			if elapsed > 0 {
				speed = float64(n) / elapsed
			}
			lastProgressAt = now
			s.transferState.UpdateProgress(fileID, sentBytes, speed)
		}

		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			s.transferState.SetStatus(fileID, state.TransferFailed, readErr.Error())
			return fmt.Errorf("read error: %w", readErr)
		}
	}

	done := webrtc.DoneMessage{
		Type:   webrtc.CtrlDone,
		FileID: fileID,
	}
	if err := s.SendControl(done); err != nil {
		s.transferState.SetStatus(fileID, state.TransferFailed, err.Error())
		return fmt.Errorf("failed to send done message: %w", err)
	}

	select {
	case <-ackCh:
		s.transferState.SetStatus(fileID, state.TransferCompleted)
		s.transferState.AddStats(transferItem.Direction, sentBytes)
		return nil
	case <-dlAbortCh:
		return ErrDownloadAborted
	case <-peerAbort:
		s.transferState.SetStatus(fileID, state.TransferPending, text.PeerLost)
		return ErrPeerAbort
	case <-time.After(15 * time.Second):
		s.transferState.SetStatus(fileID, state.TransferFailed, "timeout waiting for ack")
		return errors.New("timeout waiting for ack from receiver")
	case <-ctx.Done():
		s.transferState.SetStatus(fileID, state.TransferCancelled, "context cancelled waiting for ack")
		return ctx.Err()
	}
}

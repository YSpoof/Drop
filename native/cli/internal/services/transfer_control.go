package services

import (
	"encoding/json"
	"errors"

	"dropcli/internal/webrtc"
)

func (s *TransferService) SendDownloadMode(manual bool) error {
	return s.SendControl(webrtc.DownloadModeMessage{
		Type:   webrtc.CtrlDownloadMode,
		Manual: manual,
	})
}

// SendPull requests the remote sender to begin transfer for a pending offer.
func (s *TransferService) SendPull(fileID string) error {
	return s.SendPullBatch([]string{fileID})
}

// SendPullBatch requests the remote sender to begin transfer for one or more pending offers.
func (s *TransferService) SendPullBatch(fileIDs []string) error {
	if s.downloadService == nil {
		return errors.New("download service not configured")
	}
	if len(fileIDs) == 0 {
		return errors.New("no file ids to pull")
	}
	for _, fileID := range fileIDs {
		if err := s.downloadService.PreparePull(fileID); err != nil {
			return err
		}
	}
	if len(fileIDs) == 1 {
		return s.SendControl(webrtc.PullMessage{
			Type:   webrtc.CtrlPull,
			FileID: fileIDs[0],
		})
	}
	return s.SendControl(webrtc.PullBatchMessage{
		Type:    webrtc.CtrlPullBatch,
		FileIDs: fileIDs,
	})
}

// DismissPending dismisses a pending receive offer and notifies the peer via download-aborted.
func (s *TransferService) DismissPending(fileID string) error {
	return s.DismissPendingBatch([]string{fileID})
}

// DismissPendingBatch dismisses multiple pending offers and notifies the peer for each.
func (s *TransferService) DismissPendingBatch(fileIDs []string) error {
	if s.downloadService == nil {
		return errors.New("download service not configured")
	}
	if len(fileIDs) == 0 {
		return errors.New("no file ids to dismiss")
	}
	for _, fileID := range fileIDs {
		if err := s.downloadService.DismissPending(fileID); err != nil {
			return err
		}
		if err := s.SendControl(webrtc.DownloadAbortedMessage{
			Type:   webrtc.CtrlDownloadAborted,
			FileID: fileID,
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *TransferService) HandleControlMessage(data []byte) {
	typeStr, err := webrtc.DecodeBaseControlMessage(data)
	if err != nil {
		return
	}

	switch typeStr {
	case webrtc.CtrlMeta:
		var msg webrtc.MetaMessage
		if err := json.Unmarshal(data, &msg); err == nil && s.downloadService != nil {
			offset, _ := s.downloadService.HandleMeta(msg)
			// Quick/auto: pull each announcement so Drop starts even if it still
			// thinks the peer is manual (default peerManualDownload=true).
			if !s.downloadService.IsManual() {
				_ = s.SendControl(webrtc.PullMessage{
					Type:   webrtc.CtrlPull,
					FileID: msg.FileID,
				})
				break
			}
			// Manual/interactive: auto-pull when a retained incomplete .drop exists.
			if offset > 0 {
				fileID := msg.FileID
				go func() {
					_ = s.SendPullBatch([]string{fileID})
				}()
			}
		}

	case webrtc.CtrlStart:
		var msg webrtc.StartMessage
		if err := json.Unmarshal(data, &msg); err == nil && s.downloadService != nil {
			if err := s.downloadService.HandleStart(msg); err != nil {
				return
			}
			offset := s.downloadService.ResumeOffset()
			hash := s.downloadService.ResumeHash()
			// Seed absolute credit baseline so post-resume credits are > sender bytesConfirmed.
			s.mu.Lock()
			s.recvCreditTotal[msg.FileID] = offset
			s.mu.Unlock()
			// Drop sender waits for resume after start before streaming chunks.
			_ = s.SendControl(webrtc.ResumeMessage{
				Type:        webrtc.CtrlResume,
				FileID:      msg.FileID,
				Hash:        hash,
				BytesOffset: offset,
			})
			// Mirror Drop: lastCredited starts at resume offset (absolute BytesWritten).
			if offset > 0 {
				_ = s.SendControl(webrtc.CreditMessage{
					Type:         webrtc.CtrlCredit,
					FileID:       msg.FileID,
					BytesWritten: offset,
				})
			}
		}

	case webrtc.CtrlResume:
		var msg webrtc.ResumeMessage
		if err := json.Unmarshal(data, &msg); err == nil {
			s.mu.Lock()
			offset := msg.BytesOffset
			if expected, ok := s.activeSendHashes[msg.FileID]; !ok || expected == "" || msg.Hash != expected {
				offset = 0
			}
			if ch, exists := s.activeResumeChans[msg.FileID]; exists {
				select {
				case ch <- offset:
				default:
				}
			}
			s.mu.Unlock()
		}

	case webrtc.CtrlCredit:
		var msg webrtc.CreditMessage
		if err := json.Unmarshal(data, &msg); err == nil {
			s.mu.Lock()
			if msg.BytesWritten > s.creditConfirmed {
				s.bytesInFlight -= msg.BytesWritten - s.creditConfirmed
				s.creditConfirmed = msg.BytesWritten
			}
			if s.bytesInFlight < 0 {
				s.bytesInFlight = 0
			}
			s.cond.Broadcast()
			s.mu.Unlock()
		}

	case webrtc.CtrlDone:
		var msg webrtc.DoneMessage
		if err := json.Unmarshal(data, &msg); err == nil && s.downloadService != nil {
			_ = s.downloadService.HandleDone(msg)
		}

	case webrtc.CtrlAck:
		var msg webrtc.AckMessage
		if err := json.Unmarshal(data, &msg); err == nil {
			s.mu.Lock()
			if ch, exists := s.activeAckChans[msg.FileID]; exists {
				select {
				case ch <- struct{}{}:
				default:
				}
			}
			s.mu.Unlock()
		}

	case webrtc.CtrlBatchDone:
		s.mu.Lock()
		cb := s.onBatchDone
		s.mu.Unlock()
		if cb != nil {
			cb()
		}

	case webrtc.CtrlBye:
		s.mu.Lock()
		cb := s.onBye
		s.mu.Unlock()
		if cb != nil {
			cb()
		}

	case webrtc.CtrlDownloadMode:
		var msg webrtc.DownloadModeMessage
		if err := json.Unmarshal(data, &msg); err == nil {
			s.mu.Lock()
			s.remoteManual = msg.Manual
			s.mu.Unlock()
		}

	case webrtc.CtrlCancel:
		var msg webrtc.CancelMessage
		if err := json.Unmarshal(data, &msg); err == nil && s.downloadService != nil {
			s.downloadService.HandleCancel(msg)
		}

	case webrtc.CtrlPull:
		var msg webrtc.PullMessage
		if err := json.Unmarshal(data, &msg); err == nil {
			s.signalPull(msg.FileID)
		}

	case webrtc.CtrlPullBatch:
		var msg webrtc.PullBatchMessage
		if err := json.Unmarshal(data, &msg); err == nil {
			for _, id := range msg.FileIDs {
				s.signalPull(id)
			}
		}

	case webrtc.CtrlDownloadAborted:
		var msg webrtc.DownloadAbortedMessage
		if err := json.Unmarshal(data, &msg); err == nil {
			s.signalDownloadAbort(msg.FileID)
		}
	}
}

// ErrPeerAbort is returned when a send is interrupted by peer-loss abort (partials kept, path re-queued).
var ErrPeerAbort = errors.New("transfer aborted: peer lost")

// ErrDownloadAborted is returned when the peer dismisses a send via download-aborted (offer stays pending).
var ErrDownloadAborted = errors.New("transfer aborted: download dismissed")

func (s *TransferService) signalPull(fileID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ch, ok := s.pullWaiters[fileID]; ok {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (s *TransferService) signalDownloadAbort(fileID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ch, ok := s.dlAbortWaiters[fileID]; ok {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// EnqueueSend adds a file to the outbound send queue.

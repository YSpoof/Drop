package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sync"
	"time"

	"dropcli/internal/ports"
	"dropcli/internal/state"
	"dropcli/internal/webrtc"

	pionwebrtc "github.com/pion/webrtc/v4"
)

// SendQueueEntry holds a local absolute path and Drop announce name for outbound sends.
type SendQueueEntry struct {
	LocalPath    string
	AnnounceName string
}

// TransferService manages sending and receiving files over WebRTC data channels
// with dynamic SCTP chunk sizing, credit-based backpressure, and completion handshakes.
type TransferService struct {
	mu              sync.Mutex
	cond            *sync.Cond
	repo            ports.FileRepository
	transferState   *state.TransferState
	downloadService *DownloadService

	sendCtrl func(data []byte) error
	sendData func(chunk []byte) error

	bytesInFlight     int64
	creditConfirmed   int64
	chunkSize         uint32
	activeAckChans    map[string]chan struct{}
	activeResumeChans map[string]chan int64
	activeSendHashes  map[string]string
	activeCancel      chan struct{}
	recvCreditTotal   map[string]int64

	sendQueue      []SendQueueEntry
	sendingEntry   SendQueueEntry
	peerAbort      chan struct{}
	remoteManual   bool
	pullWaiters    map[string]chan struct{}
	dlAbortWaiters map[string]chan struct{}

	onBatchDone func()
	onBye       func()
}

// NewTransferService creates a concrete TransferService.
func NewTransferService(repo ports.FileRepository, ts *state.TransferState, ds *DownloadService) *TransferService {
	tsvc := &TransferService{
		repo:              repo,
		transferState:     ts,
		downloadService:   ds,
		chunkSize:         webrtc.DefaultChunkSize,
		activeAckChans:    make(map[string]chan struct{}),
		activeResumeChans: make(map[string]chan int64),
		activeSendHashes:  make(map[string]string),
		recvCreditTotal:   make(map[string]int64),
		peerAbort:         make(chan struct{}),
		pullWaiters:       make(map[string]chan struct{}),
		dlAbortWaiters:    make(map[string]chan struct{}),
	}
	tsvc.cond = sync.NewCond(&tsvc.mu)

	// Configure download service credit & ack handlers to emit via TransferService.
	// BytesWritten is the absolute accepted offset (Drop wire shape), not a delta.
	if ds != nil {
		ds.SetEmitCredit(func(fileID string, bytesWritten int64) error {
			tsvc.mu.Lock()
			tsvc.recvCreditTotal[fileID] = bytesWritten
			tsvc.mu.Unlock()
			return tsvc.SendControl(webrtc.CreditMessage{
				Type:         webrtc.CtrlCredit,
				FileID:       fileID,
				BytesWritten: bytesWritten,
			})
		})
		ds.SetEmitAck(func(fileID string) error {
			tsvc.mu.Lock()
			delete(tsvc.recvCreditTotal, fileID)
			tsvc.mu.Unlock()
			return tsvc.SendControl(webrtc.AckMessage{
				Type:   webrtc.CtrlAck,
				FileID: fileID,
			})
		})
	}

	return tsvc
}

// SetChunkSize sets the transmission chunk size (e.g. from SCTP negotiation).
func (s *TransferService) SetChunkSize(size uint32) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if size > 0 {
		s.chunkSize = size
	}
}

// GetChunkSize returns the current transmission chunk size.
func (s *TransferService) GetChunkSize() uint32 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.chunkSize
}

// SetOnBatchDone sets callback for when remote peer sends batch-done.
func (s *TransferService) SetOnBatchDone(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onBatchDone = fn
}

// SetOnBye sets callback when remote peer sends bye.
func (s *TransferService) SetOnBye(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onBye = fn
}

// SendDownloadMode announces local download mode on ctrl.
// manual true means local peer requires pull/confirmation; false means auto-download.
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

// SetTransports sets low-level send functions (useful for tests or custom channels).
func (s *TransferService) SetTransports(sendCtrl func(data []byte) error, sendData func(chunk []byte) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sendCtrl = sendCtrl
	s.sendData = sendData
}

// BindChannels connects the TransferService to Pion WebRTC data channels.
func (s *TransferService) BindChannels(ctrl *pionwebrtc.DataChannel, files *pionwebrtc.DataChannel) {
	s.mu.Lock()
	s.sendCtrl = func(data []byte) error {
		return ctrl.SendText(string(data))
	}
	s.sendData = func(chunk []byte) error {
		return files.Send(chunk)
	}
	s.mu.Unlock()

	ctrl.OnMessage(func(msg pionwebrtc.DataChannelMessage) {
		s.HandleControlMessage(msg.Data)
	})

	files.OnMessage(func(msg pionwebrtc.DataChannelMessage) {
		if s.downloadService != nil {
			_ = s.downloadService.HandleChunk(msg.Data)
		}
	})
}

// SendControl encodes and sends a control message over the ctrl data channel.
func (s *TransferService) SendControl(v any) error {
	s.mu.Lock()
	fn := s.sendCtrl
	s.mu.Unlock()

	if fn == nil {
		return errors.New("ctrl channel transport not set")
	}

	data, err := webrtc.EncodeControlMessage(v)
	if err != nil {
		return fmt.Errorf("failed to encode control message: %w", err)
	}
	return fn(data)
}

// HandleControlMessage decodes and routes an incoming ctrl channel message.
func (s *TransferService) HandleControlMessage(data []byte) {
	typeStr, err := webrtc.DecodeBaseControlMessage(data)
	if err != nil {
		return
	}

	switch typeStr {
	case webrtc.CtrlMeta:
		var msg webrtc.MetaMessage
		if err := json.Unmarshal(data, &msg); err == nil && s.downloadService != nil {
			_, _ = s.downloadService.HandleMeta(msg)
			// Quick/auto: pull each announcement so Drop starts even if it still
			// thinks the peer is manual (default peerManualDownload=true).
			if !s.downloadService.IsManual() {
				_ = s.SendControl(webrtc.PullMessage{
					Type:   webrtc.CtrlPull,
					FileID: msg.FileID,
				})
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
// announceName is the Drop meta.name (relative watch path or basename); empty uses basename.
func (s *TransferService) EnqueueSend(localPath, announceName string) {
	if announceName == "" {
		announceName = filepath.Base(localPath)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sendQueue = append(s.sendQueue, SendQueueEntry{
		LocalPath:    localPath,
		AnnounceName: announceName,
	})
}

// PendingSends returns a snapshot of queued outbound local paths (including re-queued in-flight).
func (s *TransferService) PendingSends() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, len(s.sendQueue))
	for i, e := range s.sendQueue {
		out[i] = e.LocalPath
	}
	return out
}

// RemoteManual reports whether the peer announced download-mode.manual.
func (s *TransferService) RemoteManual() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.remoteManual
}

// AbortPeerLoss stops in-flight transfer work, keeps receive .drop partials, and re-queues the active send.
func (s *TransferService) AbortPeerLoss() {
	s.mu.Lock()
	if s.sendingEntry.LocalPath != "" {
		s.sendQueue = append([]SendQueueEntry{s.sendingEntry}, s.sendQueue...)
		s.sendingEntry = SendQueueEntry{}
	}
	if s.peerAbort != nil {
		select {
		case <-s.peerAbort:
		default:
			close(s.peerAbort)
		}
	}
	s.peerAbort = make(chan struct{})
	clear(s.recvCreditTotal)
	s.bytesInFlight = 0
	s.creditConfirmed = 0
	s.cond.Broadcast()
	s.mu.Unlock()

	if s.downloadService != nil {
		s.downloadService.AbortKeepPartials()
	}
}

// ResetPeerAbort arms a fresh peer-abort signal after reconnect.
func (s *TransferService) ResetPeerAbort() {
	s.mu.Lock()
	defer s.mu.Unlock()
	select {
	case <-s.peerAbort:
		s.peerAbort = make(chan struct{})
	default:
	}
}

// SendFile streams a single file using basename as the announce name.
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
			s.transferState.SetStatus(fileID, state.TransferPending, "peer lost")
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
		s.transferState.SetStatus(fileID, state.TransferPending, "peer lost")
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
			s.transferState.SetStatus(fileID, state.TransferPending, "peer lost")
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
					s.transferState.SetStatus(fileID, state.TransferPending, "peer lost")
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
		s.transferState.SetStatus(fileID, state.TransferPending, "peer lost")
		return ErrPeerAbort
	case <-time.After(15 * time.Second):
		s.transferState.SetStatus(fileID, state.TransferFailed, "timeout waiting for ack")
		return errors.New("timeout waiting for ack from receiver")
	case <-ctx.Done():
		s.transferState.SetStatus(fileID, state.TransferCancelled, "context cancelled waiting for ack")
		return ctx.Err()
	}
}

// DrainSendQueue sends all queued files then batch-done. Re-queues on peer abort.
func (s *TransferService) DrainSendQueue(ctx context.Context) error {
	for {
		s.mu.Lock()
		if len(s.sendQueue) == 0 {
			s.mu.Unlock()
			return s.SendControl(webrtc.BatchDoneMessage{Type: webrtc.CtrlBatchDone})
		}
		entry := s.sendQueue[0]
		s.sendQueue = s.sendQueue[1:]
		s.mu.Unlock()

		if err := s.SendFileNamed(ctx, entry.LocalPath, entry.AnnounceName); err != nil {
			if errors.Is(err, ErrPeerAbort) {
				return err
			}
			return err
		}
	}
}

// SendBatch transmits a slice of files sequentially (basename announce names), followed by batch-done.
func (s *TransferService) SendBatch(ctx context.Context, filePaths []string) error {
	for _, fp := range filePaths {
		if err := s.SendFile(ctx, fp); err != nil {
			return err
		}
	}
	return s.SendControl(webrtc.BatchDoneMessage{Type: webrtc.CtrlBatchDone})
}

func generateID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

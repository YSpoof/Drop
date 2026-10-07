package services

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"sync"

	"dropcli/internal/ports"
	"dropcli/internal/state"
	"dropcli/internal/webrtc"

	pionwebrtc "github.com/pion/webrtc/v4"
)

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

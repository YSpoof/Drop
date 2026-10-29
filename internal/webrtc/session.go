package webrtc

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/pion/webrtc/v4"
)

const (
	DefaultSTUNServer = "stun:stun.l.google.com:19302"
	ChannelCtrl       = "ctrl"
	ChannelFiles      = "files"
)

// SessionConfig configures the WebRTC session coordinator.
type SessionConfig struct {
	ICEServers []webrtc.ICEServer
}

// DefaultSessionConfig returns standard configuration using Google STUN.
func DefaultSessionConfig() SessionConfig {
	return SessionConfig{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{DefaultSTUNServer}},
		},
	}
}

// SessionHandler handles lifecycle events and signals from the WebRTC session.
type SessionHandler interface {
	OnSignal(data []byte)
	OnReady(ctrl *webrtc.DataChannel, files *webrtc.DataChannel)
	OnStateChange(state webrtc.PeerConnectionState)
	OnClose()
}

// Session manages a Pion WebRTC peer connection, polite peer negotiation, and data channels.
type Session struct {
	mu            sync.Mutex
	cfg           SessionConfig
	localID       string
	remoteID      string
	isControlling bool

	pc        *webrtc.PeerConnection
	ctrlChan  *webrtc.DataChannel
	filesChan *webrtc.DataChannel

	handler           SessionHandler
	readyOnce         sync.Once
	closed            bool
	pendingSignals    [][]byte
	pendingCandidates []webrtc.ICECandidateInit
}

// NewSession creates an uninitialized WebRTC session.
func NewSession(handler SessionHandler, cfgs ...SessionConfig) *Session {
	cfg := DefaultSessionConfig()
	if len(cfgs) > 0 {
		cfg = cfgs[0]
	}
	return &Session{
		handler: handler,
		cfg:     cfg,
	}
}

// GetPeerConnection returns the underlying Pion PeerConnection.
func (s *Session) GetPeerConnection() *webrtc.PeerConnection {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.pc
}

// GetDataChannels returns the ctrl and files data channels if ready.
func (s *Session) GetDataChannels() (*webrtc.DataChannel, *webrtc.DataChannel) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ctrlChan, s.filesChan
}

// Start initializes the PeerConnection and begins negotiation based on peer ID tie-breaking.
func (s *Session) Start(localID, remoteID string) error {
	s.mu.Lock()

	s.localID = localID
	s.remoteID = remoteID
	s.isControlling = localID < remoteID

	config := webrtc.Configuration{
		ICEServers: s.cfg.ICEServers,
	}

	pc, err := webrtc.NewPeerConnection(config)
	if err != nil {
		s.mu.Unlock()
		return fmt.Errorf("failed to create peer connection: %w", err)
	}
	s.pc = pc

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		payload, err := marshalCandidateSignal(c.ToJSON())
		if err == nil && s.handler != nil {
			s.handler.OnSignal(payload)
		}
	})

	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		if s.handler != nil {
			s.handler.OnStateChange(state)
		}
		if state == webrtc.PeerConnectionStateClosed || state == webrtc.PeerConnectionStateFailed {
			s.Close()
		}
	})

	ordered := true
	dcInit := &webrtc.DataChannelInit{
		Ordered: &ordered,
	}

	if s.isControlling {
		ctrl, err := pc.CreateDataChannel(ChannelCtrl, dcInit)
		if err != nil {
			s.mu.Unlock()
			pc.Close()
			return fmt.Errorf("failed to create ctrl channel: %w", err)
		}
		s.setupDataChannelLocked(ctrl)

		files, err := pc.CreateDataChannel(ChannelFiles, dcInit)
		if err != nil {
			s.mu.Unlock()
			pc.Close()
			return fmt.Errorf("failed to create files channel: %w", err)
		}
		s.setupDataChannelLocked(files)

		offer, err := pc.CreateOffer(nil)
		if err != nil {
			s.mu.Unlock()
			pc.Close()
			return fmt.Errorf("failed to create offer: %w", err)
		}

		if err := pc.SetLocalDescription(offer); err != nil {
			s.mu.Unlock()
			pc.Close()
			return fmt.Errorf("failed to set local description: %w", err)
		}

		payload, err := marshalDescriptionSignal(offer)
		if err == nil && s.handler != nil {
			go s.handler.OnSignal(payload)
		}
	} else {
		pc.OnDataChannel(func(dc *webrtc.DataChannel) {
			s.mu.Lock()
			defer s.mu.Unlock()
			s.setupDataChannelLocked(dc)
		})
	}

	// Drain any signals that arrived before Start was called
	pending := s.pendingSignals
	s.pendingSignals = nil
	s.mu.Unlock()

	for _, sig := range pending {
		_ = s.HandleSignal(sig)
	}

	return nil
}

func (s *Session) setupDataChannelLocked(dc *webrtc.DataChannel) {
	if dc.Label() == ChannelCtrl {
		s.ctrlChan = dc
	} else if dc.Label() == ChannelFiles {
		s.filesChan = dc
	}

	dc.OnOpen(func() {
		s.checkReady()
	})
}

func (s *Session) checkReady() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.ctrlChan != nil && s.filesChan != nil &&
		s.ctrlChan.ReadyState() == webrtc.DataChannelStateOpen &&
		s.filesChan.ReadyState() == webrtc.DataChannelStateOpen {
		s.readyOnce.Do(func() {
			if s.handler != nil {
				go s.handler.OnReady(s.ctrlChan, s.filesChan)
			}
		})
	}
}

// FastRTC SignalPayload envelopes used by Drop web/desktop.
type descriptionSignal struct {
	Type        string                    `json:"type"`
	Description webrtc.SessionDescription `json:"description"`
}

type candidateSignal struct {
	Type      string                  `json:"type"`
	Candidate webrtc.ICECandidateInit `json:"candidate"`
}

func marshalDescriptionSignal(desc webrtc.SessionDescription) ([]byte, error) {
	return json.Marshal(descriptionSignal{Type: "description", Description: desc})
}

func marshalCandidateSignal(init webrtc.ICECandidateInit) ([]byte, error) {
	return json.Marshal(candidateSignal{Type: "candidate", Candidate: init})
}

// HandleSignal processes incoming FastRTC-wrapped signaling messages (SDP or ICE).
func (s *Session) HandleSignal(signalData []byte) error {
	s.mu.Lock()
	pc := s.pc
	if pc == nil {
		s.pendingSignals = append(s.pendingSignals, signalData)
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()

	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(signalData, &envelope); err != nil {
		return fmt.Errorf("invalid signal JSON: %w", err)
	}

	switch envelope.Type {
	case "candidate":
		var msg candidateSignal
		if err := json.Unmarshal(signalData, &msg); err != nil {
			return fmt.Errorf("failed to unmarshal ICE candidate: %w", err)
		}

		s.mu.Lock()
		if s.pc.RemoteDescription() == nil {
			s.pendingCandidates = append(s.pendingCandidates, msg.Candidate)
			s.mu.Unlock()
			return nil
		}
		s.mu.Unlock()

		return pc.AddICECandidate(msg.Candidate)

	case "description":
		var msg descriptionSignal
		if err := json.Unmarshal(signalData, &msg); err != nil {
			return fmt.Errorf("failed to unmarshal session description: %w", err)
		}

		if err := pc.SetRemoteDescription(msg.Description); err != nil {
			return fmt.Errorf("failed to set remote description: %w", err)
		}

		s.mu.Lock()
		queued := s.pendingCandidates
		s.pendingCandidates = nil
		s.mu.Unlock()

		for _, cand := range queued {
			_ = pc.AddICECandidate(cand)
		}

		if msg.Description.Type == webrtc.SDPTypeOffer {
			answer, err := pc.CreateAnswer(nil)
			if err != nil {
				return fmt.Errorf("failed to create answer: %w", err)
			}
			if err := pc.SetLocalDescription(answer); err != nil {
				return fmt.Errorf("failed to set local description: %w", err)
			}

			payload, err := marshalDescriptionSignal(answer)
			if err == nil && s.handler != nil {
				go s.handler.OnSignal(payload)
			}
		}
		return nil

	default:
		return errors.New("unrecognized signal payload")
	}
}

// IsClosed reports whether the session has been closed.
func (s *Session) IsClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

// Close gracefully closes data channels and peer connection.
func (s *Session) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return nil
	}
	s.closed = true

	if s.ctrlChan != nil {
		_ = s.ctrlChan.Close()
	}
	if s.filesChan != nil {
		_ = s.filesChan.Close()
	}
	var err error
	if s.pc != nil {
		err = s.pc.Close()
	}

	if s.handler != nil {
		go s.handler.OnClose()
	}

	return err
}

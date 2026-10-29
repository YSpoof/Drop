package webrtc

import (
	"sync"
	"testing"
	"time"

	pionwebrtc "github.com/pion/webrtc/v4"
)

type mockSessionHandler struct {
	mu       sync.Mutex
	onSignal func(data []byte)
	readyCh  chan struct{}
	ctrlChan *pionwebrtc.DataChannel
	fileChan *pionwebrtc.DataChannel
	closed   bool
}

func newMockSessionHandler() *mockSessionHandler {
	return &mockSessionHandler{
		readyCh: make(chan struct{}, 1),
	}
}

func (m *mockSessionHandler) OnSignal(data []byte) {
	m.mu.Lock()
	fn := m.onSignal
	m.mu.Unlock()
	if fn != nil {
		fn(data)
	}
}

func (m *mockSessionHandler) OnReady(ctrl *pionwebrtc.DataChannel, files *pionwebrtc.DataChannel) {
	m.mu.Lock()
	m.ctrlChan = ctrl
	m.fileChan = files
	m.mu.Unlock()

	select {
	case m.readyCh <- struct{}{}:
	default:
	}
}

func (m *mockSessionHandler) OnStateChange(state pionwebrtc.PeerConnectionState) {}

func (m *mockSessionHandler) OnClose() {
	m.mu.Lock()
	m.closed = true
	m.mu.Unlock()
}

func TestWebRTCPoliteSessionNegotiation(t *testing.T) {
	handlerA := newMockSessionHandler()
	handlerB := newMockSessionHandler()

	// Empty ICEServers for rapid local test without external STUN
	cfg := SessionConfig{ICEServers: []pionwebrtc.ICEServer{}}

	sessionA := NewSession(handlerA, cfg)
	sessionB := NewSession(handlerB, cfg)

	// Cross-wire signaling
	handlerA.onSignal = func(data []byte) {
		go func() {
			_ = sessionB.HandleSignal(data)
		}()
	}
	handlerB.onSignal = func(data []byte) {
		go func() {
			_ = sessionA.HandleSignal(data)
		}()
	}

	// Peer A has lower ID ("001" < "002"), so A is controlling and initiates offer
	if err := sessionA.Start("001", "002"); err != nil {
		t.Fatalf("failed to start session A: %v", err)
	}
	if err := sessionB.Start("002", "001"); err != nil {
		t.Fatalf("failed to start session B: %v", err)
	}

	defer sessionA.Close()
	defer sessionB.Close()

	// Wait for data channels to be ready on both sides
	select {
	case <-handlerA.readyCh:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for session A ready")
	}

	select {
	case <-handlerB.readyCh:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for session B ready")
	}

	ctrlA, filesA := sessionA.GetDataChannels()
	ctrlB, filesB := sessionB.GetDataChannels()

	if ctrlA == nil || filesA == nil || ctrlB == nil || filesB == nil {
		t.Fatal("expected all data channels to be non-nil")
	}

	// Test data channel communication
	msgReceived := make(chan string, 1)
	ctrlB.OnMessage(func(msg pionwebrtc.DataChannelMessage) {
		msgReceived <- string(msg.Data)
	})

	if err := ctrlA.SendText("hello-drop"); err != nil {
		t.Fatalf("failed to send text on ctrlA: %v", err)
	}

	select {
	case msg := <-msgReceived:
		if msg != "hello-drop" {
			t.Fatalf("unexpected message: %s", msg)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for message on ctrlB")
	}
}

func TestSCTPChunkSizeDetection(t *testing.T) {
	// Fallback when nil
	if size := GetMaxChunkSize(nil); size != DefaultChunkSize {
		t.Fatalf("expected default chunk size %d, got %d", DefaultChunkSize, size)
	}

	// DetermineChunkSize tests
	if size := DetermineChunkSize(0); size != DefaultChunkSize {
		t.Fatalf("expected fallback %d for 0, got %d", DefaultChunkSize, size)
	}
	if size := DetermineChunkSize(131072); size != 131072 {
		t.Fatalf("expected 131072, got %d", size)
	}
	if size := DetermineChunkSize(262144); size != 262144 {
		t.Fatalf("expected 262144, got %d", size)
	}
}

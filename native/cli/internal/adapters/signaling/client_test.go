package signaling

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"dropcli/internal/ports"

	"github.com/gorilla/websocket"
)

type mockSignalingHandler struct {
	mu           sync.Mutex
	connected    bool
	codeAssigned string
	peerJoining  ports.SignalingPeerInfo
	joinAccepted ports.SignalingPeerInfo
	joinRejected string
	signals      []struct {
		from string
		data []byte
	}
	errs         []error
	disconnected bool
}

func (m *mockSignalingHandler) OnConnected() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.connected = true
}

func (m *mockSignalingHandler) OnCodeAssigned(code string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.codeAssigned = code
}

func (m *mockSignalingHandler) OnPeerJoining(peer ports.SignalingPeerInfo) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.peerJoining = peer
}

func (m *mockSignalingHandler) OnJoinAccepted(peer ports.SignalingPeerInfo) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.joinAccepted = peer
}

func (m *mockSignalingHandler) OnJoinRejected(reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.joinRejected = reason
}

func (m *mockSignalingHandler) OnSignal(fromPeerID string, signalData []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.signals = append(m.signals, struct {
		from string
		data []byte
	}{from: fromPeerID, data: signalData})
}

func (m *mockSignalingHandler) OnError(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.errs = append(m.errs, err)
}

func (m *mockSignalingHandler) OnDisconnected(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.disconnected = true
}

func TestSignalingClientWithMockServer(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

	var serverReceived []string
	var serverMu sync.Mutex

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			serverMu.Lock()
			serverReceived = append(serverReceived, string(msg))
			serverMu.Unlock()

			var base BaseMessage
			if json.Unmarshal(msg, &base) == nil {
				switch base.Type {
				case TypeAnnounce:
					var ann AnnounceMessage
					_ = json.Unmarshal(msg, &ann)
					if ann.Host {
						_ = conn.WriteJSON(CodeAssignedMessage{
							Type: TypeCodeAssigned,
							Code: "888999",
						})
					}
				case TypeJoinCode:
					var jc JoinCodeMessage
					_ = json.Unmarshal(jcMsg(msg), &jc)
					if jc.Code == "888999" {
						_ = conn.WriteJSON(JoinAcceptedMessage{
							Type: TypeJoinAccepted,
							Host: &SignalingPeer{
								PeerID:      "host-node",
								DisplayName: "Host Peer",
							},
						})
					} else {
						_ = conn.WriteJSON(JoinRejectedMessage{
							Type: TypeJoinRejected,
						})
					}
				case TypeSignal:
					var sig SignalMessage
					_ = json.Unmarshal(msg, &sig)
					// Echo back as simulated remote signal
					_ = conn.WriteJSON(SignalMessage{
						Type:         TypeSignal,
						FromPeerID:   "remote-peer",
						TargetPeerID: sig.FromPeerID,
						Payload:      sig.Payload,
					})
				case TypePing:
					_ = conn.WriteJSON(PongMessage{Type: TypePong})
				}
			}
		}
	}))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	handler := &mockSignalingHandler{}
	client := NewClient()
	client.SetPingInterval(50*time.Millisecond, 50*time.Millisecond)
	client.SetHandler(handler)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := client.Connect(ctx, wsURL); err != nil {
		t.Fatalf("failed to connect: %v", err)
	}
	defer client.Close()

	time.Sleep(20 * time.Millisecond)

	handler.mu.Lock()
	if !handler.connected {
		t.Fatal("expected handler to receive OnConnected")
	}
	handler.mu.Unlock()

	// Test 1: Announce as host -> get code
	if err := client.SendAnnounce("host-peer-1", true, "TestHost"); err != nil {
		t.Fatalf("failed to send announce: %v", err)
	}

	time.Sleep(50 * time.Millisecond)

	handler.mu.Lock()
	if handler.codeAssigned != "888999" {
		t.Fatalf("expected code 888999, got %q", handler.codeAssigned)
	}
	handler.mu.Unlock()

	// Test 2: Send signal -> receive echo
	testSig := []byte(`{"sdp":"v=0..."}`)
	if err := client.SendSignal("host-peer-1", "joiner-peer", testSig); err != nil {
		t.Fatalf("failed to send signal: %v", err)
	}

	time.Sleep(50 * time.Millisecond)

	handler.mu.Lock()
	if len(handler.signals) == 0 {
		t.Fatal("expected to receive signal")
	}
	if string(handler.signals[0].data) != string(testSig) {
		t.Fatalf("signal mismatch: %s vs %s", string(handler.signals[0].data), string(testSig))
	}
	handler.mu.Unlock()

	// Test 3: Heartbeat ping-pong
	time.Sleep(120 * time.Millisecond)
	serverMu.Lock()
	pingFound := false
	for _, m := range serverReceived {
		if strings.Contains(m, `"type":"ping"`) {
			pingFound = true
			break
		}
	}
	serverMu.Unlock()

	if !pingFound {
		t.Fatal("expected server to receive at least one ping")
	}

	// Verify close
	if err := client.Close(); err != nil {
		t.Fatalf("failed to close client: %v", err)
	}
}

func jcMsg(b []byte) []byte {
	return b
}

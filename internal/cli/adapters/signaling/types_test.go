package signaling

import (
	"encoding/json"
	"testing"
)

func TestSignalingMessageMarshaling(t *testing.T) {
	// 1. Announce
	announce := AnnounceMessage{
		Type:        TypeAnnounce,
		PeerID:      "peer-123",
		Host:        true,
		DisplayName: "MyDevice",
	}
	data, err := json.Marshal(announce)
	if err != nil {
		t.Fatalf("failed to marshal announce: %v", err)
	}
	var decodedAnnounce AnnounceMessage
	if err := json.Unmarshal(data, &decodedAnnounce); err != nil {
		t.Fatalf("failed to unmarshal announce: %v", err)
	}
	if decodedAnnounce.PeerID != "peer-123" || !decodedAnnounce.Host || decodedAnnounce.DisplayName != "MyDevice" {
		t.Fatalf("unexpected announce content: %+v", decodedAnnounce)
	}

	// 2. CodeAssigned
	codeAssigned := CodeAssignedMessage{
		Type: TypeCodeAssigned,
		Code: "123456",
	}
	data, err = json.Marshal(codeAssigned)
	if err != nil {
		t.Fatalf("failed to marshal code-assigned: %v", err)
	}
	var decodedCode CodeAssignedMessage
	if err := json.Unmarshal(data, &decodedCode); err != nil {
		t.Fatalf("failed to unmarshal code-assigned: %v", err)
	}
	if decodedCode.Code != "123456" {
		t.Fatalf("unexpected code: %s", decodedCode.Code)
	}

	// 3. JoinCode
	joinCode := JoinCodeMessage{
		Type:   TypeJoinCode,
		PeerID: "peer-456",
		Code:   "654321",
	}
	data, err = json.Marshal(joinCode)
	if err != nil {
		t.Fatalf("failed to marshal join-code: %v", err)
	}
	var decodedJoin JoinCodeMessage
	if err := json.Unmarshal(data, &decodedJoin); err != nil {
		t.Fatalf("failed to unmarshal join-code: %v", err)
	}
	if decodedJoin.Code != "654321" || decodedJoin.PeerID != "peer-456" {
		t.Fatalf("unexpected join code: %+v", decodedJoin)
	}

	// 4. PeerJoining
	peerJoining := PeerJoiningMessage{
		Type: TypePeerJoining,
		Requester: &SignalingPeer{
			PeerID:      "peer-789",
			DisplayName: "JoinerNode",
		},
		Lan: true,
	}
	data, err = json.Marshal(peerJoining)
	if err != nil {
		t.Fatalf("failed to marshal peer-joining: %v", err)
	}
	var decodedJoining PeerJoiningMessage
	if err := json.Unmarshal(data, &decodedJoining); err != nil {
		t.Fatalf("failed to unmarshal peer-joining: %v", err)
	}
	if decodedJoining.Requester.PeerID != "peer-789" || decodedJoining.Requester.DisplayName != "JoinerNode" || !decodedJoining.Lan {
		t.Fatalf("unexpected peer joining: %+v", decodedJoining)
	}

	// 4b. PeerJoining missing lan → false
	var missingLan PeerJoiningMessage
	if err := json.Unmarshal([]byte(`{"type":"peer-joining","requester":{"peerId":"p1"}}`), &missingLan); err != nil {
		t.Fatalf("unmarshal missing lan: %v", err)
	}
	if missingLan.Lan {
		t.Fatal("missing lan must decode as false")
	}

	// 5. JoinAccepted
	joinAccepted := JoinAcceptedMessage{
		Type: TypeJoinAccepted,
		Host: &SignalingPeer{
			PeerID:      "peer-host",
			DisplayName: "HostNode",
		},
		Lan: true,
	}
	data, err = json.Marshal(joinAccepted)
	if err != nil {
		t.Fatalf("failed to marshal join-accepted: %v", err)
	}
	var decodedAccepted JoinAcceptedMessage
	if err := json.Unmarshal(data, &decodedAccepted); err != nil {
		t.Fatalf("failed to unmarshal join-accepted: %v", err)
	}
	if decodedAccepted.Host.PeerID != "peer-host" || !decodedAccepted.Lan {
		t.Fatalf("unexpected join accepted: %+v", decodedAccepted)
	}

	// 5b. JoinAccepted missing lan → false
	var missingLanAccepted JoinAcceptedMessage
	if err := json.Unmarshal([]byte(`{"type":"join-accepted","host":{"peerId":"h1"}}`), &missingLanAccepted); err != nil {
		t.Fatalf("unmarshal missing lan join-accepted: %v", err)
	}
	if missingLanAccepted.Lan {
		t.Fatal("missing lan on join-accepted must decode as false")
	}

	// 6. JoinRejected
	joinRejected := JoinRejectedMessage{
		Type: TypeJoinRejected,
	}
	data, err = json.Marshal(joinRejected)
	if err != nil {
		t.Fatalf("failed to marshal join-rejected: %v", err)
	}
	var decodedRejected JoinRejectedMessage
	if err := json.Unmarshal(data, &decodedRejected); err != nil {
		t.Fatalf("failed to unmarshal join-rejected: %v", err)
	}

	// 7. Signal
	rawSignal := `{"candidate":"candidate:1 1 UDP 2130706431 192.168.1.100 50000 typ host"}`
	signalMsg := SignalMessage{
		Type:         TypeSignal,
		FromPeerID:   "peer-1",
		TargetPeerID: "peer-2",
		Payload:      json.RawMessage(rawSignal),
	}
	data, err = json.Marshal(signalMsg)
	if err != nil {
		t.Fatalf("failed to marshal signal: %v", err)
	}
	var decodedSignal SignalMessage
	if err := json.Unmarshal(data, &decodedSignal); err != nil {
		t.Fatalf("failed to unmarshal signal: %v", err)
	}
	if decodedSignal.FromPeerID != "peer-1" || string(decodedSignal.Payload) != rawSignal {
		t.Fatalf("unexpected signal: %+v", decodedSignal)
	}

	// 8. Ping & Pong
	ping := PingMessage{Type: TypePing}
	pong := PongMessage{Type: TypePong}
	dataPing, _ := json.Marshal(ping)
	dataPong, _ := json.Marshal(pong)

	var base BaseMessage
	if err := json.Unmarshal(dataPing, &base); err != nil || base.Type != TypePing {
		t.Fatalf("expected ping, got %v", base.Type)
	}
	if err := json.Unmarshal(dataPong, &base); err != nil || base.Type != TypePong {
		t.Fatalf("expected pong, got %v", base.Type)
	}
}

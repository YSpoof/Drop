package signaling

import "encoding/json"

// Signaling message types.
const (
	TypeAnnounce     = "announce"
	TypeCodeAssigned = "code-assigned"
	TypeJoinCode     = "join-code"
	TypePeerJoining  = "peer-joining"
	TypeJoinAccepted = "join-accepted"
	TypeJoinRejected = "join-rejected"
	TypeSignal       = "signal"
	TypePing         = "ping"
	TypePong         = "pong"
)

// BaseMessage contains the message discriminator.
type BaseMessage struct {
	Type string `json:"type"`
}

// AnnounceMessage is sent by a client to announce its identity and role.
type AnnounceMessage struct {
	Type        string `json:"type"`
	PeerID      string `json:"peerId"`
	Host        bool   `json:"host"`
	DisplayName string `json:"displayName,omitempty"`
}

// CodeAssignedMessage is received by a host containing the 4-digit session PIN.
type CodeAssignedMessage struct {
	Type string `json:"type"`
	Code string `json:"code"`
}

// JoinCodeMessage is sent by a joiner to request pairing with a host PIN.
type JoinCodeMessage struct {
	Type   string `json:"type"`
	PeerID string `json:"peerId"`
	Code   string `json:"code"`
}

// SignalingPeer represents the nested peer object in signaling messages.
type SignalingPeer struct {
	PeerID      string `json:"peerId"`
	DisplayName string `json:"displayName,omitempty"`
}

// PeerJoiningMessage is received by a host when a peer requests to join.
type PeerJoiningMessage struct {
	Type      string         `json:"type"`
	Requester *SignalingPeer `json:"requester"`
	Lan       bool           `json:"lan,omitempty"`
}

// JoinAcceptedMessage is received by a joiner when successfully paired.
type JoinAcceptedMessage struct {
	Type string         `json:"type"`
	Host *SignalingPeer `json:"host"`
	Lan  bool           `json:"lan,omitempty"`
}

// JoinRejectedMessage is received by a joiner when pairing fails.
type JoinRejectedMessage struct {
	Type string `json:"type"`
}

// SignalMessage relays WebRTC SDP offers/answers and ICE candidates.
type SignalMessage struct {
	Type         string          `json:"type"`
	FromPeerID   string          `json:"fromPeerId,omitempty"`
	TargetPeerID string          `json:"targetPeerId,omitempty"`
	Payload      json.RawMessage `json:"payload"`
}

// PingMessage is sent for heartbeat keepalive.
type PingMessage struct {
	Type string `json:"type"`
}

// PongMessage is the heartbeat reply.
type PongMessage struct {
	Type string `json:"type"`
}

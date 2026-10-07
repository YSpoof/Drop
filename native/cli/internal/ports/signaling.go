package ports

import (
	"context"
)

// SignalingPeerInfo represents basic peer information exchanged via signaling.
type SignalingPeerInfo struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName,omitempty"`
}

// SignalingEventHandler handles asynchronous callbacks from the signaling connection.
type SignalingEventHandler interface {
	OnConnected()
	OnCodeAssigned(code string)
	OnPeerJoining(peer SignalingPeerInfo)
	OnJoinAccepted(peer SignalingPeerInfo)
	OnJoinRejected(reason string)
	OnSignal(fromPeerID string, signalData []byte)
	OnError(err error)
	OnDisconnected(err error)
}

// SignalingPort defines the interface for interacting with the Drop signaling server.
type SignalingPort interface {
	Connect(ctx context.Context, wsURL string) error
	Close() error
	SetHandler(handler SignalingEventHandler)
	SendAnnounce(peerID string, host bool, displayName string) error
	SendJoinCode(peerID string, code string) error
	SendSignal(fromPeerID string, targetPeerID string, signalData []byte) error
	SendPing() error
}

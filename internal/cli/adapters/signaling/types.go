package signaling

import (
	"drop/internal/signaling"
)

// Re-export shared constants.
const (
	TypeAnnounce     = signaling.TypeAnnounce
	TypeCodeAssigned = signaling.TypeCodeAssigned
	TypeJoinCode     = signaling.TypeJoinCode
	TypePeerJoining  = signaling.TypePeerJoining
	TypeJoinAccepted = signaling.TypeJoinAccepted
	TypeJoinRejected = signaling.TypeJoinRejected
	TypeSignal       = signaling.TypeSignal
	TypePing         = signaling.TypePing
	TypePong         = signaling.TypePong
)

// Type aliases to shared signaling types.
type BaseMessage = signaling.BaseMessage
type AnnounceMessage = signaling.AnnounceMessage
type CodeAssignedMessage = signaling.CodeAssignedMessage
type JoinCodeMessage = signaling.JoinCodeMessage
type SignalingPeer = signaling.SignalingPeer
type PeerJoiningMessage = signaling.PeerJoiningMessage
type JoinAcceptedMessage = signaling.JoinAcceptedMessage
type JoinRejectedMessage = signaling.JoinRejectedMessage
type SignalMessage = signaling.SignalMessage
type PingMessage = signaling.PingMessage
type PongMessage = signaling.PongMessage
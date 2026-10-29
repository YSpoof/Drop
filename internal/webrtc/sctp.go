package webrtc

import (
	"github.com/pion/webrtc/v4"
)

const (
	DefaultChunkSize uint32 = 65536 // 64 KiB fallback
)

// DetermineChunkSize returns the optimal chunk size given a negotiated SCTP max message size.
// If the negotiated size is 0 (unspecified/infinite/unnegotiated), it falls back to 65,536 bytes.
func DetermineChunkSize(sctpMaxMsgSize uint32) uint32 {
	if sctpMaxMsgSize == 0 {
		return DefaultChunkSize
	}
	return sctpMaxMsgSize
}

// GetMaxChunkSize queries the PeerConnection's SCTP transport to determine the negotiated
// maximum message size, falling back to DefaultChunkSize (65,536 bytes).
func GetMaxChunkSize(pc *webrtc.PeerConnection) uint32 {
	if pc == nil {
		return DefaultChunkSize
	}
	sctp := pc.SCTP()
	if sctp == nil {
		return DefaultChunkSize
	}
	return DetermineChunkSize(sctp.GetCapabilities().MaxMessageSize)
}

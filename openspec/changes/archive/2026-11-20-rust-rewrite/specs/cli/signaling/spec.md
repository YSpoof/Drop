# Spec Delta

## MODIFIED Requirements

### Requirement: WebRTC signal relaying
The client SHALL relay WebRTC session descriptions and ICE candidates to the remote peer using `signal` messages over the WebSocket connection. The `payload` field SHALL use the FastRTC `SignalPayload` envelope: session descriptions as `{ "type": "description", "description": <RTCSessionDescriptionInit> }` and ICE candidates as `{ "type": "candidate", "candidate": <RTCIceCandidateInit> }`. The client SHALL NOT send a raw SDP string or bare ICECandidateInit objects as the signal payload.

#### Scenario: Relaying session description
- **WHEN** the local WebRTC stack produces an offer or answer description
- **THEN** the client transmits a `signal` message whose `payload` is `{ "type": "description", "description": { "type": "offer"|"answer", "sdp": "..." } }`

#### Scenario: Relaying ICE candidate
- **WHEN** the local WebRTC stack produces an ICE candidate
- **THEN** the client transmits a `signal` message whose `payload` is `{ "type": "candidate", "candidate": <ICECandidateInit> }`

#### Scenario: Applying remote FastRTC signals
- **WHEN** the client receives a `signal` message with a FastRTC-wrapped payload
- **THEN** the client unwraps the envelope and applies the description or candidate to the local peer connection

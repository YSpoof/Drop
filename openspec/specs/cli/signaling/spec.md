# CLI Signaling Specification

## Purpose

Manages WebSocket communication with Drop signaling servers to allocate session PINs, pair peers, and exchange WebRTC connection descriptors.

## Requirements

### Requirement: Signaling endpoint resolution
The client SHALL connect directly to the signaling WebSocket URL, defaulting to `https://drop.lzart.com.br/ws` (normalized to `wss://drop.lzart.com.br/ws`), or the URL specified in the `DROP_WS_URL` environment variable if present. The client SHALL normalize `http://` to `ws://` and `https://` to `wss://`. The CLI SHALL NOT accept a command-line flag that overrides the signaling URL; only the default and `DROP_WS_URL` apply.

#### Scenario: Default URL resolution
- **WHEN** `DROP_WS_URL` is unset
- **THEN** the client connects to `wss://drop.lzart.com.br/ws`

#### Scenario: Custom environment URL resolution
- **WHEN** `DROP_WS_URL` is set to `http://localhost:5173/ws`
- **THEN** the client connects to `ws://localhost:5173/ws`

#### Scenario: No CLI URL override
- **WHEN** the user attempts to pass a signaling URL via a CLI flag (e.g. former `-url`)
- **THEN** the CLI rejects the unknown/removed flag and does not change the resolved signaling URL

### Requirement: Host peer announcement and code allocation
When hosting, the client SHALL send an announce message indicating host role and receive a 4-digit numeric PIN assigned by the signaling server.

#### Scenario: Host announcement and code assignment
- **WHEN** the host connects to signaling and sends an announce message with `host: true`
- **THEN** the server returns a `code-assigned` message containing the 4-digit numeric PIN

### Requirement: Join pairing request
When joining, the client SHALL send an announce message followed by a `join-code` message specifying the target PIN. The client SHALL parse peer information (peer ID and display name) from a nested `requester` object (in `peer-joining` messages) or `host` object (in `join-accepted` messages).

#### Scenario: Join request accepted
- **WHEN** the joiner sends a valid, active 4-digit code
- **THEN** the server responds with `join-accepted` containing the host peer info nested in a `host` object and notifies the host with `peer-joining` containing the requester info nested in a `requester` object
- **AND** the client SHALL establish the WebRTC connection using the parsed remote peer ID from the `payload` field of `signal` messages

#### Scenario: Join request rejected
- **WHEN** the joiner sends an unknown or expired PIN code
- **THEN** the server responds with `join-rejected` and the client reports a pairing error

### Requirement: WebRTC signal relaying
The client SHALL relay WebRTC session descriptions and ICE candidates to the remote peer using `signal` messages over the WebSocket connection. The `payload` field SHALL use the FastRTC `SignalPayload` envelope: session descriptions as `{ "type": "description", "description": <RTCSessionDescriptionInit> }` and ICE candidates as `{ "type": "candidate", "candidate": <RTCIceCandidateInit> }`. The client SHALL NOT send raw Pion SDP or bare ICECandidateInit objects as the signal payload.

#### Scenario: Relaying session description
- **WHEN** the local WebRTC stack produces an offer or answer description
- **THEN** the client transmits a `signal` message whose `payload` is `{ "type": "description", "description": { "type": "offer"|"answer", "sdp": "..." } }`

#### Scenario: Relaying ICE candidate
- **WHEN** the local WebRTC stack produces an ICE candidate
- **THEN** the client transmits a `signal` message whose `payload` is `{ "type": "candidate", "candidate": <ICECandidateInit> }`

#### Scenario: Applying remote FastRTC signals
- **WHEN** the client receives a `signal` message with a FastRTC-wrapped payload
- **THEN** the client unwraps the envelope and applies the description or candidate to the local peer connection

### Requirement: Heartbeat keepalive
The client SHALL send periodic `ping` messages to the signaling server and monitor for `pong` responses, triggering reconnection if responses are missed. Signaling reconnection during an active CLI session SHALL preserve the ability to wait for peer re-pair (wait-to-reconnect) rather than forcing process exit solely due to a transient signaling drop.

#### Scenario: Heartbeat ping exchange
- **WHEN** the connection is idle during the heartbeat interval
- **THEN** the client sends a `ping` message and resets the timeout upon receiving `pong`

#### Scenario: Heartbeat timeout reconnection
- **WHEN** no `pong` is received within the heartbeat timeout period
- **THEN** the client closes the dead socket and attempts reconnection

#### Scenario: Signaling drop during wait-to-reconnect
- **WHEN** the CLI is waiting for a peer to reconnect and the signaling WebSocket drops
- **THEN** the client attempts signaling reconnection and continues waiting for peer re-pair once signaling is restored
- **AND** does not exit solely due to that transient signaling drop

### Requirement: Re-pair after peer leave
While a host or joiner remains in an active PIN session and the signaling WebSocket is usable (or is reconnected per heartbeat rules), the client SHALL allow a subsequent peer-joining / join-accepted pairing and a new WebRTC negotiation after a prior peer connection has been torn down. The client MUST NOT require a process restart to accept the next peer for the same PIN session.

#### Scenario: Host accepts peer again after disconnect
- **WHEN** a host had a peer connected, the WebRTC session was closed due to peer leave, and signaling remains (or returns) available
- **THEN** a later `peer-joining` for the same PIN MAY start a new WebRTC session

#### Scenario: Joiner can reconnect after disconnect
- **WHEN** a joiner's WebRTC session closes due to peer leave and the joiner remains in the PIN session
- **THEN** the joiner MAY re-announce/re-join as required by the signaling server and negotiate a new WebRTC session without exiting the process

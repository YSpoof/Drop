# Spec Delta

## ADDED Requirements

### Requirement: LAN pairing flag from signaling
When the signaling server includes optional `lan: true` on `peer-joining` or `join-accepted` (same public-IPv4 detection used by Drop web), the CLI SHALL parse that field and expose it to session state for UI labeling. Absence of `lan` or `lan: false` SHALL be treated as non-LAN (no LAN badge). The CLI MUST NOT invent LAN status from ICE candidate types when the signaling flag is absent.

#### Scenario: Host receives lan on peer-joining
- **WHEN** the host receives `peer-joining` with `lan: true`
- **THEN** session state records the pending/current pairing as LAN for UI

#### Scenario: Joiner receives lan on join-accepted
- **WHEN** the joiner receives `join-accepted` with `lan: true`
- **THEN** session state records the pairing as LAN for UI

#### Scenario: Missing lan means non-LAN
- **WHEN** the client receives `peer-joining` or `join-accepted` without `lan: true`
- **THEN** session state treats the pairing as non-LAN for UI

## MODIFIED Requirements

### Requirement: Join pairing request
When joining, the client SHALL send an announce message followed by a `join-code` message specifying the target PIN. The client SHALL parse peer information (peer ID and display name) from a nested `requester` object (in `peer-joining` messages) or `host` object (in `join-accepted` messages). The client SHALL also parse the optional boolean `lan` field on those messages per the LAN pairing flag from signaling requirement.

#### Scenario: Join request accepted
- **WHEN** the joiner sends a valid, active 4-digit code
- **THEN** the server responds with `join-accepted` containing the host peer info nested in a `host` object and notifies the host with `peer-joining` containing the requester info nested in a `requester` object
- **AND** the client SHALL establish the WebRTC connection using the parsed remote peer ID from the `payload` field of `signal` messages
- **AND** when those messages include `lan: true`, the client records LAN pairing for UI

#### Scenario: Join request rejected
- **WHEN** the joiner sends an unknown or expired PIN code
- **THEN** the server responds with `join-rejected` and the client reports a pairing error

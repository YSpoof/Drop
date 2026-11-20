# Spec Delta

## MODIFIED Requirements

### Requirement: Dynamic SCTP chunk size negotiation
The system SHALL query the peer connection's SCTP transport to determine the negotiated maximum message size, advertising the chosen size in `start` control messages and using it as the transmission chunk size. The frame limit SHALL be the negotiated size capped at 262,144 bytes (256 KiB), and the chosen chunk size SHALL be that limit minus the 4-byte stream header, so a whole `files` frame never exceeds the limit.

#### Scenario: Negotiated SCTP max message size detected
- **WHEN** the SCTP transport provides a finite negotiated maximum message size N of at most 262,144 bytes
- **THEN** the sender sets the chunk size to N − 4 and transmits it in the `start` control message

#### Scenario: SCTP max message size fallback
- **WHEN** the SCTP transport reports zero, infinite, or an unnegotiated size
- **THEN** the sender uses a 65,536-byte frame limit and a 65,532-byte chunk size

#### Scenario: Oversized negotiated size is capped
- **WHEN** the SCTP transport reports a negotiated maximum message size above 262,144 bytes
- **THEN** the sender uses 262,140 bytes as the chunk size and transmits that value in the `start` control message

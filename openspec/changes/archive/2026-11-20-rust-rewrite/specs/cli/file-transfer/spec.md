# Spec Delta

## MODIFIED Requirements

### Requirement: Dynamic SCTP chunk size negotiation
The system SHALL query the peer connection's SCTP transport to determine the negotiated maximum message size, advertising the chosen size in `start` control messages and using it as the transmission chunk size. The chosen size SHALL be the negotiated size capped at 262,144 bytes (256 KiB).

#### Scenario: Negotiated SCTP max message size detected
- **WHEN** the SCTP transport provides a finite negotiated maximum message size of at most 262,144 bytes
- **THEN** the sender sets the data channel chunk size to that value and transmits it in the `start` control message

#### Scenario: SCTP max message size fallback
- **WHEN** the SCTP transport reports zero, infinite, or an unnegotiated size
- **THEN** the sender defaults to 65,536 bytes (64 KiB) as the fallback chunk size

#### Scenario: Oversized negotiated size is capped
- **WHEN** the SCTP transport reports a negotiated maximum message size above 262,144 bytes
- **THEN** the sender uses 262,144 bytes as the chunk size and transmits that value in the `start` control message

### Requirement: Folder watching and dynamic broadcast
The system SHALL recursively watch a configured directory tree for file creations and modifications, including files under newly created subdirectories, and automatically announce those files to connected peers using relative `meta.name` paths per the relative-path requirement. Watching only the top-level directory without descending into subdirectories does not satisfy this requirement. A file SHALL be queued only after its size has stopped changing: two equal size readings 50 ms apart, or after 2 seconds of polling at the latest. Files and directories whose name starts with `.` SHALL be ignored, together with everything beneath a dot-prefixed directory; the watched root itself is exempt.

#### Scenario: New file added to watched directory
- **WHEN** a new file is created within the watched folder tree
- **THEN** the watcher detects the event, generates a file identifier, and queues the file for announcement

#### Scenario: Nested subdirectory file is detected
- **WHEN** the CLI watches `/data/inbox` and a file is created at `/data/inbox/nested/deep/file.bin`
- **THEN** the watcher queues that file for announcement
- **AND** the eventual `meta.name` uses a relative path under `inbox/...`

#### Scenario: New subdirectory then file
- **WHEN** a new subdirectory appears under the watched root and a file is later created inside it
- **THEN** the watcher detects that file and queues it for announcement

#### Scenario: File still being written is not sent early
- **WHEN** a file is being copied into the watched tree and its size is still growing
- **THEN** the watcher does not queue it until its size has stopped changing
- **AND** the file is queued once for that write, not once per write event

#### Scenario: Hidden entries are ignored
- **WHEN** `.hidden.txt` or `.cache/tmp.bin` is created under the watched root
- **THEN** the watcher does not queue either file

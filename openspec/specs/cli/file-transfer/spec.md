# CLI File Transfer Specification

## Purpose

Manages peer-to-peer data channels for robust bidirectional file streaming, flow control backpressure, folder watching, and transfer synchronization compatible with Drop.

## Requirements

### Requirement: Data channel establishment
The system SHALL establish two ordered WebRTC data channels named `ctrl` and `files` using ID tie-breaking where the peer with the lower peer ID initiates channel creation. Negotiation signaling exchanged during establishment SHALL use FastRTC `SignalPayload` envelopes so the CLI interoperates with Drop web and desktop peers.

#### Scenario: Lower ID peer initiates
- **WHEN** the local peer ID is lexicographically lower than the remote peer ID
- **THEN** the local peer creates the `ctrl` and `files` data channels and initiates WebRTC negotiation with FastRTC-wrapped description and candidate signals

#### Scenario: Higher ID peer responds
- **WHEN** the local peer ID is lexicographically higher than the remote peer ID
- **THEN** the local peer waits for remote data channels and answers FastRTC-wrapped offers

### Requirement: Dynamic SCTP chunk size negotiation
The system SHALL query the peer connection's SCTP transport to determine the negotiated maximum message size, advertising this size in `start` control messages and using it as the transmission chunk size.

#### Scenario: Negotiated SCTP max message size detected
- **WHEN** the SCTP transport provides a finite negotiated maximum message size
- **THEN** the sender sets the data channel chunk size to that value and transmits it in the `start` control message

#### Scenario: SCTP max message size fallback
- **WHEN** the SCTP transport reports zero, infinite, or an unnegotiated size
- **THEN** the sender defaults to 65,536 bytes (64 KiB) as the fallback chunk size

### Requirement: File metadata announcement
Before streaming a file, the sender SHALL send a JSON control message of type `meta` on the `ctrl` channel specifying `fileId`, `name`, `size`, `mime`, and Drop-compatible `hash` (`name|size|mtimeMs` file identity).

#### Scenario: Announce file to peer
- **WHEN** a file is queued for transmission
- **THEN** a `meta` message is dispatched over `ctrl` including `fileId`, `name`, `size`, `mime`, and `hash`
- **AND** progress state is set to pending

### Requirement: Credit-based flow control
The system SHALL enforce an 8 MiB in-flight buffer window where the sender pauses chunk transmission until the receiver emits `credit` messages acknowledging written bytes.

#### Scenario: Credit generation on receive
- **WHEN** the receiver writes received chunks totaling at least 1 MiB or completes the file
- **THEN** the receiver sends a `credit` message on `ctrl` with the cumulative bytes written

#### Scenario: Sender pause on window exhaustion
- **WHEN** unacknowledged bytes in flight reach the 8 MiB window limit
- **THEN** the sender pauses sending chunks on `files` until a `credit` message frees window capacity

### Requirement: Transfer completion handshake
The sender SHALL emit a `done` message on `ctrl` upon sending the final chunk of a file, and the receiver SHALL verify written length and reply with an `ack` message.

#### Scenario: Successful file completion handshake
- **WHEN** all file chunks are received and written to disk
- **THEN** the receiver sends `ack` on `ctrl` and the sender marks the file completed

### Requirement: Folder watching and dynamic broadcast
The system SHALL recursively watch a configured directory tree for file creations and modifications, including files under newly created subdirectories, and automatically announce those files to connected peers using relative `meta.name` paths per the relative-path requirement. Watching only the top-level directory without descending into subdirectories does not satisfy this requirement.

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

### Requirement: Relative path in outbound meta name
When announcing a file that belongs to a watched folder (or any send rooted at a directory tree), the sender SHALL set `meta.name` to a Drop-compatible relative path using forward slashes, including the watched folder’s basename as the first path segment (e.g. watching `/tmp/photos` yields `photos/a.jpg`, not `a.jpg`). Single-file or multi-file positional sends (regular files, not a watched directory) MAY keep a basename-only `name`. The Drop identity `hash` SHALL be computed from that same `name` string plus size and mtime.

#### Scenario: Watched file announces relative path
- **WHEN** the CLI watches directory `/data/project` and a new file `/data/project/src/main.go` is queued for send
- **THEN** the outbound `meta` message uses `name` equal to `project/src/main.go` (forward slashes)
- **AND** `hash` equals `fileIdentity("project/src/main.go", size, mtimeMs)`

#### Scenario: Single-file send keeps basename
- **WHEN** the CLI sends with positional path `/tmp/report.pdf`
- **THEN** the outbound `meta.name` is `report.pdf`

### Requirement: Sender waits for pull when peer is manual
When the remote peer’s download mode is manual (`download-mode` with `manual: true`), after announcing a file via `meta` the sender SHALL NOT emit `start` or file bytes for that `fileId` until it receives a matching inbound `pull` or `pull-batch` that includes that `fileId`. When the remote peer’s download mode is automatic (`manual: false`) or not yet known as manual, the sender MAY proceed with `start` and bytes after `meta` as today for auto peers.

#### Scenario: Manual peer gates binary send
- **WHEN** the remote peer has announced `download-mode` with `manual: true` and the CLI has sent `meta` for `fileId` F
- **THEN** the CLI does not send `start` or file chunks for F until an inbound `pull` or `pull-batch` includes F

#### Scenario: Auto peer sends without pull
- **WHEN** the remote peer has announced `download-mode` with `manual: false` and the CLI has a queued file to send
- **THEN** the CLI may send `meta` then `start` and file bytes without waiting for `pull`

#### Scenario: Pull batch starts listed files
- **WHEN** the remote peer is manual and sends `pull-batch` with `fileIds` including F and G that were announced and not aborted
- **THEN** the CLI may begin `start`/binary transfer for those files in send order

### Requirement: Inbound download-aborted resets send offer
When the sender receives `download-aborted` for a `fileId` it has announced (pending pull or in-flight), the sender SHALL stop transferring that file if active, treat the offer as dismissed for the current pull wait, reset local progress/status for that file to pending (as if not yet successfully sent), and MUST NOT require process exit. A later `pull` / `pull-batch` for the same `fileId` MAY start the transfer again if the file remains queued/announced.

#### Scenario: Abort while waiting for pull
- **WHEN** the peer is manual, the CLI has announced `meta` for F, and the peer sends `download-aborted` for F before pull
- **THEN** the CLI clears any pending-pull wait for F
- **AND** keeps F available as a pending send offer rather than marking it completed

#### Scenario: Abort mid-send
- **WHEN** the CLI is sending F and receives `download-aborted` for F
- **THEN** the CLI stops the in-flight send for F
- **AND** resets that transfer’s status to pending in local state

### Requirement: Download-mode announcement
When data channels become ready, the local peer SHALL send `download-mode` with `manual: false` in quick mode and `manual: true` in interactive mode. Inbound `download-mode` SHALL continue to update the remote peer preference using the `manual` field.

#### Scenario: Interactive announces manual
- **WHEN** interactive mode data channels become ready
- **THEN** the client sends `{ "type": "download-mode", "manual": true }` on `ctrl`

#### Scenario: Quick announces auto
- **WHEN** quick mode data channels become ready
- **THEN** the client sends `{ "type": "download-mode", "manual": false }` on `ctrl`

#### Scenario: Apply remote download-mode
- **WHEN** the client receives `{ "type": "download-mode", "manual": <bool> }`
- **THEN** the client updates the remote peer's download-mode preference using the `manual` field

### Requirement: Manual-mode pull receive
When the local peer has announced manual download mode (`download-mode` with `manual: true`), receiving a remote `meta` SHALL register a pending offer and MUST NOT start the binary receive until the local peer sends a `pull` (or `pull-batch`) for that `fileId`, except when the auto-resume incomplete receive requirement applies. After `pull`, the existing `start` / chunk / `done` / `ack` handshake SHALL proceed as today.

#### Scenario: Meta held until pull
- **WHEN** local download mode is manual and a `meta` arrives whose identity hash has no retained incomplete `.drop` eligible for auto-resume
- **THEN** the transfer layer records a pending offer for that `fileId`
- **AND** no `resume`/`start` receive path begins until a local pull for that id

#### Scenario: Pull starts transfer
- **WHEN** the local peer sends `{ "type": "pull", "fileId": "<id>" }` for a pending offer
- **THEN** the remote sender may begin `start` and binary transfer for that file
- **AND** the local receiver accepts the stream into the download directory

### Requirement: Auto-resume incomplete receive on matching hash
When local download mode is manual (interactive), and an inbound `meta` includes a Drop identity `hash` for which the download directory still has an incomplete `{hash}.drop` with size greater than zero and less than the announced file size, the CLI SHALL automatically send `pull` / `pull-batch` for that `fileId` without requiring the user to select `Baixar`. Wire resume (offset from the partial + `resume` control) SHALL proceed as today. If the user previously dismissed/cancelled that identity (partial deleted), a later re-announce of the same hash MUST remain a normal pending offer and MUST NOT auto-pull.

#### Scenario: Re-announce with retained partial auto-pulls
- **WHEN** interactive mode is connected, `{H}.drop` exists incomplete for identity hash `H`, and the peer sends `meta` with `hash: H` and a new `fileId` F
- **THEN** the CLI sends pull for F without user selection
- **AND** the receive resumes from the retained partial offset

#### Scenario: Fresh announce without partial stays manual
- **WHEN** interactive mode receives `meta` for hash `H` and no incomplete `{H}.drop` exists
- **THEN** the offer appears in the pending inbox
- **AND** no pull is sent until the user chooses `Baixar`

#### Scenario: Dismissed identity does not auto-resume
- **WHEN** the user dismissed an offer for hash `H` (partial discarded) and the peer later re-announces `meta` with `hash: H`
- **THEN** the offer is pending only
- **AND** the CLI does not auto-pull

### Requirement: Consolidate transfer row on identity resume
When a receive transfer for Drop identity hash `H` fails or is interrupted due to peer loss and a later receive for the same hash `H` begins (new `fileId`), the transfer list SHALL replace or update the prior failed row for `H` so only one row for that identity remains, reflecting the new receive progress/status. The list MUST NOT keep both the failed peer-loss row and a separate active row for the same identity hash.

#### Scenario: Failed row replaced on resume
- **WHEN** the transfer list shows a failed receive for hash `H` after peer loss and a new receive for `H` becomes active
- **THEN** the list shows a single row for that file identity in the active/in-progress state
- **AND** the prior failed peer-loss row for `H` is no longer listed separately

### Requirement: Dismiss pending receive offer
The local peer SHALL be able to dismiss a pending receive offer without downloading. Dismissal SHALL notify the remote peer using a Drop-compatible control message (`download-aborted` and/or `cancel` as required for interop) so the sender stops waiting for pull on that file.

#### Scenario: Dismiss notifies peer
- **WHEN** the user removes a pending inbox item that was announced via `meta`
- **THEN** the CLI sends the dismiss/abort control message for that `fileId`
- **AND** the pending offer is cleared locally

### Requirement: Batch-done as batch boundary
An inbound `batch-done` on `ctrl` SHALL mark the end of the remote peer's current send batch. It SHALL NOT by itself imply that the WebRTC session or CLI receive/wait process must terminate.

#### Scenario: Empty idle batch-done
- **WHEN** a connected Drop web peer has no queued files and emits `batch-done` (idle notify)
- **THEN** the transfer layer surfaces batch completion to listeners without requiring session teardown

#### Scenario: Real batch after files
- **WHEN** one or more files complete and the sender emits `batch-done`
- **THEN** receivers may treat the batch as finished while keeping the session available for further transfers unless a higher-level mode explicitly exits

### Requirement: Transfer cancellation and session termination
The system SHALL allow cancellation of in-flight file transfers via `cancel` messages and clean session termination via `bye` messages. Session teardown for a receive/wait peer SHALL use `bye` or user cancel to end the CLI session; unexpected transport failure after ready SHALL abort the transfer session and keep incomplete `.drop` partials for reconnect (see peer-loss abort) rather than treating failure alone as mandatory process exit. User-initiated cancel/dismiss SHALL clean partial `.drop` files; peer-loss abort SHALL NOT.

#### Scenario: Transfer cancellation
- **WHEN** a file transfer is cancelled by either peer (user cancel / dismiss)
- **THEN** a `cancel` (and/or `download-aborted` as required) message is sent on `ctrl`
- **AND** resources are released and the matching `.drop` partial is deleted
- **AND** next queued transfers may proceed

#### Scenario: Clean disconnection
- **WHEN** the session is closed by the user
- **THEN** a `bye` message is sent on `ctrl` and the WebRTC peer connection is closed gracefully

#### Scenario: Remote bye
- **WHEN** the remote peer sends `bye` on `ctrl`
- **THEN** the local transfer layer notifies session listeners so the CLI can end the session cleanly

#### Scenario: Transport failure keeps partials
- **WHEN** the WebRTC transport fails after ready during an incomplete receive
- **THEN** incomplete `.drop` files are retained
- **AND** the transfer layer signals disconnect for reconnect handling rather than requiring immediate process exit solely due to that failure

### Requirement: Partial download `.drop` files
While receiving a file, the system SHALL write bytes to a partial file named from the Drop file identity (`hash`) with a `.drop` suffix in the download directory (sanitizing characters unsafe for the filesystem). The system SHALL rename the partial to the announced final name (choosing a unique available name on collision) only after a successful completion handshake. Incomplete `.drop` files MUST NOT use the final filename as the sole on-disk representation during transfer.

#### Scenario: Mid-transfer disk name
- **WHEN** a receive starts for a file with identity hash `H` and announced name `photo.jpg`
- **THEN** chunks are written to a file whose name is derived from `H` and ends in `.drop`
- **AND** `photo.jpg` is not created as the live write target until completion succeeds

#### Scenario: Rename on successful completion
- **WHEN** the receiver completes `done` verification for a file written to `{identity}.drop`
- **THEN** the partial is renamed into the download directory under the announced name (or a unique collision-safe variant)
- **AND** the `.drop` partial no longer remains for that identity

### Requirement: File identity hash for resume
Outbound `meta` SHALL include a Drop-compatible `hash` field equal to `fileIdentity(name, size, mtimeMs)` as used by Drop desktop (`name|size|mtime`). Inbound resume SHALL use the peer-provided `hash` to locate `{hash}.drop` and MUST include that same `hash` on outbound `resume` messages. When a sender receives `resume`, it SHALL honor `bytesOffset` only if `hash` matches the local file identity; otherwise it SHALL restart from offset 0.

#### Scenario: Meta carries identity hash
- **WHEN** the CLI announces a file for send
- **THEN** the `meta` control message includes `hash` computed as `name|size|mtimeMs` for that file

#### Scenario: Resume offset from matching `.drop`
- **WHEN** a `start` begins for a file whose identity hash `H` already has a `.drop` partial with size `S` where `0 < S < fileSize`
- **THEN** the receiver chunk-aligns `S` downward to the negotiated chunk size and sends `resume` with `hash: H` and that aligned `bytesOffset`
- **AND** subsequent writes append to the existing `.drop` from that offset

#### Scenario: Resume hash mismatch forces restart
- **WHEN** the sender receives `resume` whose `hash` does not match the local file identity
- **THEN** the sender transmits from offset 0

### Requirement: Peer-loss abort keeps partials
When the WebRTC peer connection or data channels fail or close after transfers have started, the transfer layer SHALL abort in-flight writers/readers without deleting incomplete `.drop` files, clear ephemeral in-memory transfer session state needed for a new peer connection, and allow a later re-pair to resume. This abort MUST NOT by itself require the CLI process to exit.

#### Scenario: Disconnect mid-download keeps `.drop`
- **WHEN** the peer connection closes while a receive into `{hash}.drop` is incomplete
- **THEN** the partial `.drop` remains on disk
- **AND** the transfer layer stops using the dead channels without removing that partial

#### Scenario: Disconnect mid-upload re-queues send
- **WHEN** the peer connection closes while the CLI is sending a file
- **THEN** the in-flight send aborts
- **AND** the file remains eligible to be announced/sent again after a new peer connection is ready
- **AND** a later matching `resume` may continue from the receiver's offset

### Requirement: Discard incomplete on cancel or different peer
The system SHALL delete the relevant `.drop` partial(s) when the user cancels or dismisses a transfer/offer (Drop-compatible `cancel` / `download-aborted`), and SHALL delete all incomplete `.drop` files in the download directory when a newly connected peer ID differs from the last successfully connected peer ID for this CLI process session.

#### Scenario: User cancel discards partial
- **WHEN** the user cancels an in-flight or incomplete receive for identity hash `H`
- **THEN** `{H}.drop` is removed from the download directory if present

#### Scenario: Different peer discards all partials
- **WHEN** a new WebRTC session becomes ready with remote peer ID `B` and the last connected peer ID was `A` where `A ≠ B`
- **THEN** all `*.drop` incomplete files in the download directory are removed before new transfers proceed

#### Scenario: Same peer reconnect keeps partials
- **WHEN** the same remote peer ID reconnects after a prior disconnect
- **THEN** existing `.drop` partials for that peer's files are retained for resume

### Requirement: Finalize preserves relative meta.name path
When a receive completes successfully, the CLI SHALL place the final file under the configured download directory using the announced `meta.name` relative path (forward slashes mapped to the local filesystem), creating any missing parent directories. Path segments MUST reject parent-directory traversal (`..`). On name collision under that relative path, the CLI SHALL choose a unique available leaf name while keeping the same parent directory. Incomplete `.drop` partials remain flat basenames in the download directory root as today.

#### Scenario: Nested announce name creates parent dirs
- **WHEN** a receive completes for a file announced as `photos/nested/a.jpg`
- **THEN** the final file exists at `<download-dir>/photos/nested/a.jpg` (or a unique collision-safe leaf under `photos/nested/`)
- **AND** parent directories `photos` and `photos/nested` exist under the download directory

#### Scenario: Traversal segments rejected
- **WHEN** a receive would finalize with an announced name containing a `..` path segment
- **THEN** the CLI rejects that path and MUST NOT write outside the download directory via path traversal

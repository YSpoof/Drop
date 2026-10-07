# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

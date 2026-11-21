# Spec Delta

## ADDED Requirements

### Requirement: File frames carry the stream ID from start

Every peer (browser, desktop, CLI) SHALL assign a stream ID in each `start` message, distinct from the previous stream ID on that connection. Each binary frame on `files` SHALL begin with that stream ID as a 4-byte big-endian unsigned integer, followed by the file bytes. The header does not count toward file offsets, credits, or the 8 MiB window.

#### Scenario: Frame layout

- **WHEN** a sender transmits file bytes after `start` with stream ID S
- **THEN** every `files` frame is 4 bytes holding S in big-endian order followed by at most one chunk of file bytes

#### Scenario: New stream ID per start

- **WHEN** the same file is started a second time on one connection (for example after `download-aborted` and a new pull)
- **THEN** the second `start` carries a stream ID different from the first

### Requirement: Receiver drops frames from other streams

The receiver SHALL write a `files` frame only when its stream ID matches the stream of the file it is currently receiving and that file's `resume` has been sent. It SHALL silently drop every other frame, including frames shorter than 4 bytes, and MUST NOT count dropped bytes toward offsets or credits.

#### Scenario: Late chunks of an aborted file

- **WHEN** the receiver aborts file A and frames of A's stream arrive after file B has started
- **THEN** those frames are dropped and B's download contains only B's bytes

#### Scenario: Frame before resume

- **WHEN** a frame with the current stream ID arrives before the receiver has sent `resume` for that file
- **THEN** the frame is dropped

### Requirement: Sender gives up on a missing resume or ack

After sending `start`, the sender SHALL wait at most 30 seconds for the matching `resume`, and after sending `done` at most 15 seconds for the matching `ack`. On timeout the sender SHALL mark that file failed, send `cancel` for it, and continue with the next queued file.

#### Scenario: No resume

- **WHEN** the receiver never answers a `start` with `resume`
- **THEN** after 30 seconds the sender marks the file failed, sends `cancel`, and starts the next queued file

#### Scenario: No ack

- **WHEN** the receiver never answers `done` with `ack`
- **THEN** after 15 seconds the sender marks the file failed and continues with the next queued file

### Requirement: Read failure cancels only that file

When reading a file's bytes fails on the sender (for example the file changed or was removed), the sender SHALL send `cancel` for that file, mark it failed, and continue with the next queued file. The session MUST stay usable for further transfers.

#### Scenario: Source file removed mid-send

- **WHEN** the sender cannot read the next chunk of a file
- **THEN** the sender sends `cancel` for that `fileId`, shows the file as failed, and the next queued file is sent

### Requirement: Each start waits for its own resume

The sender SHALL start streaming a file only from the offset in the `resume` that answers the current `start`. An offset received for an earlier start of the same file MUST NOT be used.

#### Scenario: Re-pull after download-aborted

- **WHEN** the receiver aborts a file at offset N, pulls it again, and answers the new `start` with `resume` at offset M
- **THEN** the sender streams from M, not from N

### Requirement: Chunk size is capped for every peer

Every sender SHALL size frames so that a whole `files` frame (4-byte stream header plus file bytes) never exceeds the negotiated SCTP maximum message size capped at 262,144 bytes, or 65,536 bytes when the size is zero, infinite, or unknown. The chunk size advertised in `start` and used for file bytes SHALL be that limit minus 4.

#### Scenario: Browser reports a huge maximum

- **WHEN** a browser peer connection reports an SCTP maximum message size above 262,144 bytes
- **THEN** the sender uses 262,140-byte chunks, every frame is at most 262,144 bytes, and the transfer progresses

#### Scenario: Negotiated maximum below the cap

- **WHEN** the negotiated SCTP maximum message size is N with N at most 262,144
- **THEN** the sender uses chunks of N − 4 file bytes and no frame exceeds N bytes

#### Scenario: Unknown maximum

- **WHEN** the SCTP maximum message size is zero, infinite, or not available
- **THEN** the sender uses 65,532-byte chunks

### Requirement: Dismissing a pending offer notifies the sender

When the receiver dismisses a file that was announced with `meta` but not yet started, the receiver SHALL send `download-aborted` for that `fileId` and remove the offer locally. The sender SHALL then stop waiting for a pull of that file.

#### Scenario: Dismiss before pull

- **WHEN** the receiver dismisses a pending offer in manual mode
- **THEN** the receiver sends `download-aborted` for that `fileId` and the sender does not keep the file waiting for a pull

### Requirement: Batch-done once per finished batch

A sender SHALL send `batch-done` exactly once after the last file of a batch it sent has finished (completed, failed, or cancelled). It MUST NOT send `batch-done` when no file was sent since the previous `batch-done`.

#### Scenario: Idle queue

- **WHEN** the sender's queue is checked and no file was sent since the last `batch-done`
- **THEN** no `batch-done` is sent

#### Scenario: Batch of three files

- **WHEN** the sender finishes the third and last file of a batch
- **THEN** it sends one `batch-done`

### Requirement: A pull batch of any size completes

When a browser receiver pulls files with `pull-batch` and saves them as one archive, the archive SHALL be finalized after the last file of that batch finishes, including a batch of one file. A later pull MUST start a new archive or download.

#### Scenario: Single-file pull-batch

- **WHEN** the receiver pulls one file with `pull-batch`
- **THEN** that download is finalized when the file finishes and the next pulled file is not appended to it

### Requirement: Receiving without streaming downloads is size-limited

When a browser receiver cannot stream downloads to disk (no service worker), it SHALL hold each received file in browser storage until it completes, which is an exception to the receiver memory window. To bound that memory it SHALL accept such files only up to 536,870,912 bytes (512 MiB) each. For a larger file it SHALL send `download-aborted` for that `fileId`, keep the offer pending, show the user that the file is too large for this browser, and continue with other files.

#### Scenario: Small file without a service worker

- **WHEN** a browser without a service worker receives a file of at most 512 MiB
- **THEN** the file is saved as one download when it completes, with exact bytes

#### Scenario: Large file without a service worker

- **WHEN** a browser without a service worker is offered a file larger than 512 MiB and the transfer starts
- **THEN** the receiver sends `download-aborted` for that file, shows that the file is too large for this browser, and the next file is received normally

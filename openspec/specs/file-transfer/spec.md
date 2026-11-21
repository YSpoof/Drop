# file-transfer Specification

## Purpose

Keep a file transfer from putting the whole payload in the receiver heap, and make the sender progress follow bytes the receiver has actually accepted.

## Requirements

### Requirement: Receiver confirms accepted bytes

The receiver SHALL confirm a file offset only after those bytes have been accepted by the download stream write. A confirmation is an absolute offset from the start of the file. Confirmations for one file MUST be monotonic. A confirmation MUST NOT count bytes that have only arrived on the file channel.

#### Scenario: Arrival is not acceptance

- **WHEN** a file chunk arrives and the download stream write for that chunk has not finished
- **THEN** the receiver does not confirm that chunk

#### Scenario: Accepted prefix is confirmable

- **WHEN** the download stream write accepts bytes through offset N
- **THEN** the receiver may confirm offset N, and MUST NOT confirm an offset above N

### Requirement: Sender stays within an 8 MiB window

The sender SHALL NOT have more than 8 MiB of file bytes sent and not yet confirmed. It MUST wait for a confirmation before sending any further byte that would exceed that window. The wait MUST end without further bytes of that file when the send is aborted, the file is cancelled, or the receiver stops the download.

#### Scenario: Slow receiver pauses the sender

- **WHEN** the sender is transferring a file larger than 8 MiB and the receiver confirms slowly
- **THEN** the sender pauses with at most 8 MiB unconfirmed

#### Scenario: Cancel ends the wait

- **WHEN** the file is cancelled or the session aborts while the sender is waiting for a confirmation
- **THEN** the sender stops waiting and sends no further bytes of that file

#### Scenario: Foreign confirmation is ignored

- **WHEN** a confirmation names a file the sender is not currently sending
- **THEN** the sender does not move the current file's confirmed offset

### Requirement: Sender progress follows confirmations

While a send of a non-empty file is in progress, the sender's reported transferred bytes SHALL be the highest confirmed offset and SHALL be less than the file size. The sender SHALL report that file completed, with transferred bytes equal to the file size, only after the receiver's completion acknowledgement. That acknowledgement happens after the download stream has closed.

#### Scenario: Bar stays behind an unfinished receive

- **WHEN** the receiver has confirmed an offset below the file size
- **THEN** the sender progress shows that offset and the send stays in progress

#### Scenario: Completion follows the receiver ack

- **WHEN** the receiver acknowledges the file after closing the download stream
- **THEN** the sender reports the file completed and the transferred bytes equal the file size

### Requirement: Resume counts the prefix as confirmed

After the receiver resumes a partial file at offset N, the sender SHALL treat N as already confirmed. The 8 MiB window applies only to bytes past N. The sender MUST NOT send bytes below N.

#### Scenario: Resume continues from the partial file

- **WHEN** the receiver resumes at offset N and N is greater than 0 and less than the file size
- **THEN** the sender starts at N, reports progress at N, and does not put more than 8 MiB past N in flight before the next confirmation

### Requirement: Receiver-side file removal during download

When the receiver removes or dismisses a file mid-download, the receiver SHALL instantly remove and hide the file from its transfer and history list, abort and discard the download stream, and delete the incomplete `.drop` file from disk.

#### Scenario: Receiver removes file mid-download

- **WHEN** the receiver removes a file while it is downloading
- **THEN** the file is instantly removed from the receiver's list, the incomplete `.drop` file is deleted from disk, the download stream is aborted with discard, and the sender is notified via `download-aborted`

### Requirement: Sender reset on receiver download abort

When the sender receives a `download-aborted` notification because the receiver removed or stopped the download, the sender SHALL reset the file's progress and status to pending as if never sent, keeping the file in the sender's transfer list without removing it.

#### Scenario: Sender resets progress on download abort

- **WHEN** the sender receives `download-aborted` for an in-flight or partial file transfer
- **THEN** the sender resets that file's progress to 0 and status to pending in the sender's view, remaining visible in the sender's transfer list

### Requirement: Receiver memory stays within the window

For a file larger than 8 MiB, the receiver SHALL NOT retain the whole file in memory. Unconfirmed file bytes held by the receiver MUST stay within the 8 MiB window. A desktop receive MUST NOT accumulate an append batch: bytes the download stream has already accepted stay limited to the chunk being pushed into that file's write body.

#### Scenario: Large desktop receive does not hold the file

- **WHEN** a desktop receiver is taking a file larger than 8 MiB and the disk write is slower than the network
- **THEN** the receiver's unconfirmed file bytes stay within 8 MiB, and already-accepted bytes are not held in a multi-megabyte append batch

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

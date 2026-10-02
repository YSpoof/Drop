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

### Requirement: Receiver memory stays bounded

For a file larger than 8 MiB, the receiver SHALL NOT retain the whole file in memory. Unconfirmed file bytes held by the receiver MUST stay within the 8 MiB window. A native receive MUST NOT accumulate an append batch: bytes the download stream has already accepted stay limited to the chunk being pushed into that file's write body.

#### Scenario: Large native receive does not hold the file

- **WHEN** a native receiver is taking a file larger than 8 MiB and the disk write is slower than the network
- **THEN** the receiver's unconfirmed file bytes stay within 8 MiB, and already-accepted bytes are not held in a multi-megabyte append batch

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

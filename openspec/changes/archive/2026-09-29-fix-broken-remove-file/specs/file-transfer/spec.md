# Spec Delta

## ADDED Requirements

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

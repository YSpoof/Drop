# Spec Delta

## ADDED Requirements

### Requirement: Receiver memory stays within the window

For a file larger than 8 MiB, the receiver SHALL NOT retain the whole file in memory. Unconfirmed file bytes held by the receiver MUST stay within the 8 MiB window. A desktop receive MUST NOT accumulate an append batch: bytes the download stream has already accepted stay limited to the chunk being pushed into that file's write body.

#### Scenario: Large desktop receive does not hold the file

- **WHEN** a desktop receiver is taking a file larger than 8 MiB and the disk write is slower than the network
- **THEN** the receiver's unconfirmed file bytes stay within 8 MiB, and already-accepted bytes are not held in a multi-megabyte append batch

## REMOVED Requirements

### Requirement: Receiver memory stays bounded

**Reason**: Restated with "desktop" in place of "native" wording.

**Migration**: See the receiver memory stays within the window requirement; behavior is the same.

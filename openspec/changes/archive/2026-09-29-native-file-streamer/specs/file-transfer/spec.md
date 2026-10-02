# Spec Delta

## MODIFIED Requirements

### Requirement: Receiver memory stays bounded

For a file larger than 8 MiB, the receiver SHALL NOT retain the whole file in memory. Unconfirmed file bytes held by the receiver MUST stay within the 8 MiB window. A native receive MUST NOT accumulate an append batch: bytes the download stream has already accepted stay limited to the chunk being pushed into that file's write body.

#### Scenario: Large native receive does not hold the file

- **WHEN** a native receiver is taking a file larger than 8 MiB and the disk write is slower than the network
- **THEN** the receiver's unconfirmed file bytes stay within 8 MiB, and already-accepted bytes are not held in a multi-megabyte append batch

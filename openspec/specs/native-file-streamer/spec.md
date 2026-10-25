# native-file-streamer Specification

## Purpose

Move native transfer file bytes between the desktop shell and disk as raw streams, so those bytes are not base64-encoded on the way in or out. If that stream is unavailable, the same transfer still completes through the existing filesystem calls.

## Requirements

### Requirement: Native shell starts a loopback streamer

When the native shell starts, it SHALL run an in-process HTTP streamer bound to `127.0.0.1` on an ephemeral port. The streamer SHALL share the per-process token with the native shell. When the shell terminates, the streamer stops accepting connections. The web app SHALL NOT launch this streamer.

#### Scenario: Streamer announces an address

- **WHEN** the native shell has started
- **THEN** the shell learns a `127.0.0.1` port and a token for that process

#### Scenario: Shell exit stops the streamer

- **WHEN** the native shell closes
- **THEN** the streamer stops accepting connections

#### Scenario: Web app has no streamer

- **WHEN** the app is running in a browser
- **THEN** no streamer is started and transfers do not call it

### Requirement: Streamer rejects unauthenticated clients

The streamer SHALL refuse a read or write that does not present the current process token. It SHALL NOT return file bytes or write disk bytes for a missing or wrong token. Binding to `127.0.0.1` is not a substitute for the token.

#### Scenario: Missing token

- **WHEN** a request hits the streamer without the current token
- **THEN** the streamer returns an error and does not read or write the requested file

#### Scenario: Wrong token

- **WHEN** a request presents a token other than the one announced for this process
- **THEN** the streamer returns an error and does not read or write the requested file

### Requirement: Native send reads one stream per file

While the streamer is ready, a native send of one file SHALL read that file through a single byte stream starting at the send offset. The sender SHALL still hand the peer chunks of the existing chunk size taken from that stream, in order. The bytes on that stream MUST NOT be base64-encoded. A read that does not continue at the stream cursor SHALL close that stream and open another from the new offset.

#### Scenario: Sequential chunks share one read

- **WHEN** the native sender reads a file from offset 0 through successive chunk-sized slices and the streamer is ready
- **THEN** those slices come from one read stream and match the file bytes at those offsets

#### Scenario: Resume opens at the confirmed offset

- **WHEN** a native send resumes at offset N and N is greater than 0
- **THEN** the read stream starts at N and does not return bytes below N

#### Scenario: Read stream is raw

- **WHEN** the streamer is serving a send
- **THEN** the file bytes are transferred as raw octets, not as base64 text

### Requirement: Native receive writes one stream per file

While the streamer is ready, a native receive of one file SHALL write that file as raw octets, not base64. Each chunk SHALL be its own request with a known length, because a streamed request body requires HTTP/2 and this server is HTTP/1.1. The first request of a receive that starts at offset 0 MUST replace any existing file at the destination. Every later request, and every request of a receive that starts at offset N greater than 0, MUST append and MUST NOT truncate bytes already in the file. A chunk MUST be on disk before its write is accepted. Closing the download stream with no chunks SHALL still create or replace the destination. Aborting the download SHALL stop the request in flight. A discarded download SHALL remove the partial file. A non-discard abort SHALL leave the partial file on disk.

#### Scenario: New file replaces the destination

- **WHEN** a native receive starts at offset 0 through the streamer
- **THEN** the destination file is replaced and contains only the bytes written by this receive

#### Scenario: Resume appends

- **WHEN** a native receive starts at offset N, N is greater than 0, and the partial file already contains N bytes
- **THEN** the streamer appends the new body after those N bytes and the file begins with the original prefix

#### Scenario: Close flushes the body

- **WHEN** the download stream closes after the streamer has accepted the receive
- **THEN** the destination file contains every byte that the stream write accepted

#### Scenario: Discard removes the partial

- **WHEN** a native receive through the streamer is aborted as a discard
- **THEN** the partial destination file is removed

#### Scenario: Other abort keeps the partial

- **WHEN** a native receive through the streamer is aborted for a reason other than discard
- **THEN** the request stops and the bytes already written stay on disk

### Requirement: Native transfers require the streamer

A native send or receive SHALL read and write file bytes only through the streamer. If the streamer is not running, that transfer MUST fail. It MUST NOT fall back to base64 filesystem reads or appends. The web receive path MUST stay on its current download stream.

#### Scenario: Sidecar not ready

- **WHEN** a native send or receive needs file bytes and the sidecar has not announced a port and token
- **THEN** that transfer fails and no base64 filesystem read or append runs

#### Scenario: Web receive is unchanged

- **WHEN** a browser receive writes a file
- **THEN** it does not call the streamer

### Requirement: Non-byte filesystem work stays put

Listing, creating, and removing directories, moving and removing files, reading file size and existence, watching folders, picking folders, and writing the clipboard MUST work through Go native host bridge calls. They MUST NOT depend on the file streaming endpoints being active.

#### Scenario: Rename after a streamed receive

- **WHEN** a streamed receive has closed and the app moves the partial file to its final name
- **THEN** the move uses the Go native host bridge call and does not require another streamer request

#### Scenario: Folder watch without the sidecar

- **WHEN** no file transfer is active and the user picks a folder to watch
- **THEN** the folder dialog and the watch use the Go native host bridge calls

### Requirement: Streamer runs in-process with the native host

The Go desktop shell SHALL run the HTTP file streamer within the same process as the native shell and RPC bridge, eliminating runtime binary extraction to temporary directories.

#### Scenario: Streamer starts in-process

- **WHEN** the Go desktop shell process starts
- **THEN** the HTTP file streamer initializes in-process without extracting sidecar binaries to disk

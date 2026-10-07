# native-file-streamer Specification

## Purpose

Move native transfer file bytes between the desktop shell and disk as raw streams, so those bytes are not base64-encoded on the way in or out. If that stream is unavailable, the same transfer still completes through the existing filesystem calls.

## Requirements

### Requirement: Native shell starts a loopback streamer

When the native shell starts, it SHALL launch a streamer sidecar bound to `127.0.0.1` on an ephemeral port. The sidecar SHALL tell the shell that port and a per-process token before the shell uses it for transfer bytes. The startup message on standard input is bootstrap data, and that input closing MUST NOT stop the sidecar. The sidecar SHALL exit when the framework connection closes. The web app SHALL NOT launch this sidecar.

#### Scenario: Sidecar announces an address

- **WHEN** the native shell has started the sidecar
- **THEN** the shell learns a `127.0.0.1` port and a token for that process

#### Scenario: Shell exit stops the sidecar

- **WHEN** the native shell closes its framework connection
- **THEN** the sidecar exits and stops accepting connections

#### Scenario: Web app has no sidecar

- **WHEN** the app is running in a browser
- **THEN** no streamer sidecar is started and transfers do not call it

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

Listing, creating, and removing directories, moving and removing files, reading file size and existence, watching folders, picking folders, and writing the clipboard MUST keep working through their current native calls. They MUST NOT depend on the streamer being ready.

#### Scenario: Rename after a streamed receive

- **WHEN** a streamed receive has closed and the app moves the partial file to its final name
- **THEN** the move uses the current native filesystem call and does not require another streamer request

#### Scenario: Folder watch without the sidecar

- **WHEN** the sidecar is not running and the user picks a folder to watch
- **THEN** the folder dialog and the watch still use the current native calls

### Requirement: Packaged shells include an x64 streamer

A packaged native shell for linux x64 and windows x64 SHALL include a streamer executable for that OS embedded within the application resources. The streamer source and its compiled binaries SHALL live under `native/extensions/` in this repository. The production/CI native package build SHALL compile those binaries for linux x64 and windows x64 before packaging. The native shell SHALL extract the streamer executable from the Neutralino resources path that embeds those compiled binaries to a writable temporary location at runtime and launch that executable. The streamer extension will no longer be launched automatically by Neutralino via configuration commands.

#### Scenario: Each package can launch its sidecar

- **WHEN** a linux x64 or windows x64 package starts
- **THEN** that package launches the streamer executable built for the same OS and x64

#### Scenario: Extension is extracted from resources at startup

- **WHEN** the native shell starts
- **THEN** the shell extracts the platform-appropriate streamer binary from the configured Neutralino resources path for compiled streamers under the `native/extensions` tree to a writable temporary directory
- **AND** the shell makes the binary executable and launches the streamer process using Neutralino.os.spawnProcess()
- **AND** the shell provides the streamer with the necessary Neutralino bootstrap data via stdin (port, token, connectToken, extensionID)
- **AND** the streamer executable runs and communicates with the shell as specified, broadcasting `streamerReady` events

#### Scenario: Extension cleanup on shell exit

- **WHEN** the native shell closes its framework connection
- **THEN** the spawned streamer process exits
- **AND** any temporary extracted extension files may be cleaned up

#### Scenario: CI compiles streamer from native/extensions

- **WHEN** the production Docker/CI native package stage runs
- **THEN** it builds `streamer-linux_x64` and `streamer-win_x64.exe` from `native/extensions/streamer` (or equivalent module path under `native/extensions`) before embedding them in the package

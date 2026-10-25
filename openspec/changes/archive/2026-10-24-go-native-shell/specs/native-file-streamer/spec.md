# Spec Delta

## MODIFIED Requirements

### Requirement: Native shell starts a loopback streamer

When the native shell starts, it SHALL run an in-process HTTP streamer bound to `127.0.0.1` on an ephemeral port. The streamer SHALL share the per-process token with the native shell. When the shell terminates, the streamer stops accepting connections. The web app SHALL NOT launch this streamer.

#### Scenario: Sidecar announces an address
- **WHEN** the native shell has started
- **THEN** the shell learns a `127.0.0.1` port and a token for that process

#### Scenario: Shell exit stops the sidecar
- **WHEN** the native shell closes
- **THEN** the streamer stops accepting connections

#### Scenario: Web app has no sidecar
- **WHEN** the app is running in a browser
- **THEN** no streamer is started and transfers do not call it

### Requirement: Non-byte filesystem work stays put

Listing, creating, and removing directories, moving and removing files, reading file size and existence, watching folders, picking folders, and writing the clipboard MUST work through Go native host bridge calls. They MUST NOT depend on the file streaming endpoints being active.

#### Scenario: Rename after a streamed receive
- **WHEN** a streamed receive has closed and the app moves the partial file to its final name
- **THEN** the move uses the Go native host bridge call and does not require another streamer request

#### Scenario: Folder watch without the sidecar
- **WHEN** no file transfer is active and the user picks a folder to watch
- **THEN** the folder dialog and the watch use the Go native host bridge calls

## REMOVED Requirements

### Requirement: Packaged shells include an x64 streamer
**Reason**: Replaced by unified Go desktop shell binary.
**Migration**: The Go desktop shell embeds streaming functionality directly, eliminating separate sidecar binaries and runtime extraction.

## ADDED Requirements

### Requirement: Streamer runs in-process with the native host

The Go desktop shell SHALL run the HTTP file streamer within the same process as the native shell and RPC bridge, eliminating runtime binary extraction to temporary directories.

#### Scenario: Streamer starts in-process
- **WHEN** the Go desktop shell process starts
- **THEN** the HTTP file streamer initializes in-process without extracting sidecar binaries to disk

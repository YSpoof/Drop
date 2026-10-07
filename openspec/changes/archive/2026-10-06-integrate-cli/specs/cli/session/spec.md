# Spec Delta

## Purpose

Provides interactive terminal navigation and non-interactive command-line controls for hosting, joining, file broadcasting, and receiving transfers within the Drop ecosystem.

## ADDED Requirements

### Requirement: Interactive mode startup
The CLI SHALL start an interactive terminal prompt when launched without execution flags, presenting clear options to Host a session, Join an existing session, or Configure settings.

#### Scenario: User selects Host
- **WHEN** user launches the CLI without flags and selects "Host"
- **THEN** the CLI transitions to the host waiting screen and requests a session PIN

#### Scenario: User selects Join
- **WHEN** user launches the CLI without flags and selects "Join"
- **THEN** the CLI prompts the user for a session PIN code

#### Scenario: User opens config menu
- **WHEN** user launches the CLI without flags and selects "Configure settings"
- **THEN** the CLI presents a settings form with the current persisted device name, download directory, and a reset-stats option
- **AND** the form does not include an auto-download control

### Requirement: Interactive PIN input
The CLI SHALL prompt the user for a 4-digit numeric PIN code when joining a session and validate its format before initiating signaling.

#### Scenario: Valid 4-digit PIN entered
- **WHEN** user inputs a 4-digit numeric string (e.g., "1234")
- **THEN** the CLI accepts the input and begins connecting to the target host

#### Scenario: Invalid PIN entered
- **WHEN** user inputs a non-numeric string or a string with length other than 4 digits
- **THEN** the CLI displays a validation error and prompts for re-entry

### Requirement: Host session presentation
The CLI SHALL display the assigned 4-digit PIN code prominently upon hosting and show the live connection status until a peer connects or the user exits. While the PIN is shown, the CLI SHALL expose the copy-code (`c`) and copy-share-link (`C`) actions defined by the copy session code and share link requirement.

#### Scenario: PIN display and peer connection
- **WHEN** the signaling server assigns a code to the host
- **THEN** the CLI displays the PIN and updates the screen to indicate connection when a peer joins

#### Scenario: Host UI hints copy shortcuts
- **WHEN** the host PIN is displayed in the interactive session UI
- **THEN** the UI indicates that `c` copies the code and `C` copies the share link

### Requirement: Copy session code and share link
While a host session PIN is known, the CLI SHALL let the user copy the 4-digit PIN with the `c` key and copy the Drop-compatible share URL with the `C` key (Shift+c). The share URL SHALL match Drop’s shape: `{origin}/share/?hostid={localPeerId}&code={pin}` where `{origin}` is the HTTPS origin derived from the configured signaling host (default `https://drop.lzart.com.br`). The CLI SHALL copy to the system clipboard and give brief UI feedback on success or failure. The CLI SHALL NOT add a separate print-only share-link command; displaying the PIN as today remains sufficient on screen.

#### Scenario: Copy PIN with c
- **WHEN** the host has an assigned PIN and the user presses `c`
- **THEN** the 4-digit PIN is written to the system clipboard
- **AND** the UI acknowledges the copy (e.g. brief status/toast text)

#### Scenario: Copy share link with C
- **WHEN** the host has an assigned PIN and a local peer ID, and the user presses `C`
- **THEN** a URL of the form `{origin}/share/?hostid={peerId}&code={pin}` is written to the system clipboard
- **AND** the UI acknowledges the copy

#### Scenario: Share origin follows signaling host
- **WHEN** the signaling WebSocket URL host is `drop.lzart.com.br` (default)
- **THEN** the share link origin is `https://drop.lzart.com.br`

#### Scenario: Keys unavailable without host PIN
- **WHEN** no host PIN is assigned yet (or the session is join-only without a local host code)
- **THEN** pressing `c` / `C` does not invent a PIN or share URL

### Requirement: Device identity configuration
The CLI SHALL allow setting a custom device display name, defaulting to the local machine hostname when unspecified.

#### Scenario: Custom device name provided
- **WHEN** the user specifies a device name via flag or prompt
- **THEN** the CLI announces this display name to signaling and remote peers

#### Scenario: Default hostname used
- **WHEN** no custom device name is specified
- **THEN** the CLI retrieves and announces the local machine hostname

### Requirement: Download directory configuration
The CLI SHALL allow configuring the directory path where received files are saved, defaulting to the current working directory.

#### Scenario: Custom download directory provided
- **WHEN** user configures a target directory path
- **THEN** incoming downloaded files are saved into that directory

#### Scenario: Default directory fallback
- **WHEN** no download directory is configured
- **THEN** incoming downloaded files are saved into the current working directory

### Requirement: Auto-download toggle
Auto-download SHALL be derived only from launch mode: quick mode (`-q`) always auto-downloads incoming files; interactive mode (no `-q`) always uses manual receive (inbox). The CLI SHALL NOT persist an auto-download preference in `~/.dropConfig`. The interactive settings flow SHALL NOT expose an Auto-download toggle.

#### Scenario: Quick mode auto-download
- **WHEN** the user runs with `-q` and a peer sends files
- **THEN** announced files are downloaded automatically without an inbox UI

#### Scenario: Interactive mode manual receive
- **WHEN** the user runs without `-q` and connects a session
- **THEN** the CLI announces manual download mode to the peer
- **AND** incoming files appear in the receive inbox for Download or Remove

#### Scenario: Settings form has no auto-download control
- **WHEN** the user opens interactive settings configuration
- **THEN** the form does not include an Auto-download toggle

#### Scenario: Config does not persist auto-download
- **WHEN** the CLI writes `~/.dropConfig`
- **THEN** the file does not store an auto-download preference
- **AND** a legacy `autoDownload` field in an existing file is ignored on load and omitted on the next save

### Requirement: Interactive receive inbox
When the CLI runs in interactive mode (no `-q`) and a WebRTC session is ready, the CLI SHALL present a live inbox of remote files announced via `meta` that have not yet been downloaded or dismissed. Each pending entry SHALL offer actions to download that file and to remove/dismiss that file. The inbox SHALL update as new announcements arrive and as downloads complete or items are removed. The CLI process SHALL remain in the session until the user cancels or the peer sends `bye`. Unexpected transport failure after ready SHALL enter wait-to-reconnect rather than ending the interactive session by itself.

#### Scenario: Pending file appears in inbox
- **WHEN** the interactive CLI is connected and the remote peer announces a file with `meta`
- **THEN** the inbox lists that file (name and size at minimum) with Download and Remove actions
- **AND** the file is not written to disk until the user chooses Download

#### Scenario: Download from inbox
- **WHEN** the user selects Download on a pending inbox item
- **THEN** the CLI requests that file from the peer and writes it to the configured download directory
- **AND** progress for that transfer is visible in the interactive session

#### Scenario: Remove from inbox
- **WHEN** the user selects Remove on a pending inbox item
- **THEN** the item leaves the inbox without downloading
- **AND** the peer is notified so the offer is no longer treated as awaiting pull
- **AND** any `.drop` partial for that offer is discarded

#### Scenario: Quick mode has no inbox
- **WHEN** the user runs with `-q`
- **THEN** the CLI does not present the interactive receive inbox
- **AND** incoming files are auto-downloaded per quick-mode receive behavior

#### Scenario: Peer leave returns to wait reconnect
- **WHEN** interactive mode had a ready session and the peer transport fails
- **THEN** the CLI shows waiting-to-reconnect status and keeps the process alive for re-pair
- **AND** does not exit solely due to that transport failure

### Requirement: Quick receive session persistence
When quick mode connects without `-f` or `-d` (receive/wait mode), the CLI SHALL remain in the session after WebRTC becomes ready until the user cancels (e.g. Ctrl+C) or the peer sends a `bye` control message. An inbound `batch-done` MUST NOT terminate this wait loop by itself. Unexpected signaling/WebRTC transport failure after ready SHALL enter wait-to-reconnect indefinitely rather than exiting the process.

#### Scenario: Idle batch-done from Drop web does not exit
- **WHEN** the CLI is in quick receive/wait mode and the remote Drop web peer sends `batch-done` with no files transferred
- **THEN** the CLI continues waiting for incoming files and does not print a session-ending "Transfers complete" exit path solely due to that message

#### Scenario: User cancel ends receive wait
- **WHEN** the CLI is in quick receive/wait mode and the user cancels the process
- **THEN** the CLI exits the wait loop and shuts down
- **AND** incomplete `.drop` partials are discarded

#### Scenario: Peer bye ends receive wait
- **WHEN** the CLI is in quick receive/wait mode and the remote peer sends `bye` on the ctrl channel
- **THEN** the CLI ends the session cleanly

#### Scenario: Transport failure waits to reconnect
- **WHEN** the CLI is in quick receive/wait mode after ready and the WebRTC transport fails
- **THEN** the CLI shows waiting-to-reconnect and remains running for re-pair
- **AND** does not exit solely due to that failure

#### Scenario: Send-once modes still exit after their send
- **WHEN** the CLI runs quick mode with `-f` (single file send)
- **THEN** after that file transfer and outbound `batch-done`, the CLI may exit as today if the send completed successfully
- **AND** if the peer drops mid-send before completion, the CLI waits to reconnect and retries/resumes rather than exiting as success
- **AND** directory-watch mode (`-d`) continues until user cancel as today

### Requirement: Quick mode command-line execution
The CLI SHALL support non-interactive command-line flags to host or join, specify files to send, watch directories, and set custom output folders without interactive prompts. Host or join without `-f`/`-d` SHALL enter receive/wait mode and remain connected per the quick receive session persistence requirement (including wait-to-reconnect after post-ready transport failure).

#### Scenario: Quick mode host with files
- **WHEN** user runs with `-q -h -f <path>`
- **THEN** the CLI starts as host, displays the assigned PIN, queues the specified file for transfer, and exits after successful transfer completion

#### Scenario: Quick mode join with PIN
- **WHEN** user runs with `-q -c <pin>`
- **THEN** the CLI connects directly to the specified host PIN without interactive prompt
- **AND** if neither `-f` nor `-d` is set, the CLI enters receive/wait mode and stays until cancel, `bye`, or successful completion paths defined elsewhere — not solely on transient transport failure after ready

#### Scenario: Quick mode host receive wait
- **WHEN** user runs with `-q -h` and neither `-f` nor `-d`
- **THEN** the CLI hosts, waits for a peer, and after WebRTC ready stays available for incoming files until cancel or `bye`, waiting to reconnect across transient peer drops

#### Scenario: Quick mode with custom output directory
- **WHEN** user runs with `-q -c <pin> -o <path>` or `-o <path>`
- **THEN** the CLI sets `<path>` as the destination directory for downloaded files instead of the current working directory

#### Scenario: Missing required flags in quick mode
- **WHEN** user runs with `-q` but provides neither `-h` nor `-c`
- **THEN** the CLI exits with a non-zero status code and displays usage instructions

### Requirement: WebRTC connect failure reporting
After a remote peer is paired for the **initial** connect (or a reconnect attempt), the CLI SHALL wait for the WebRTC session to become ready. If the peer connection fails or readiness is not reached within approximately 15 seconds **before** the session has ever become ready for that pairing attempt, the CLI SHALL end that pairing attempt with a clear error. After a session has already been ready once, subsequent peer loss SHALL follow wait-to-reconnect instead of this initial-connect hard failure path. While waiting to reconnect, a failed reconnect attempt SHALL keep waiting rather than exiting the process.

#### Scenario: Connect timeout
- **WHEN** a peer joins or join is accepted but data channels do not become ready within ~15 seconds on the first pairing attempt
- **THEN** the CLI reports a connection timeout/failure for that attempt

#### Scenario: Peer connection failed
- **WHEN** the WebRTC peer connection transitions to failed before the first ready in this session
- **THEN** the CLI reports the failure for that attempt

#### Scenario: Post-ready failure does not use hard exit path
- **WHEN** the session was already ready and later the peer connection fails
- **THEN** the CLI enters wait-to-reconnect rather than exiting with a fatal peer-connection error

### Requirement: Wait to reconnect after peer leave
After WebRTC has become ready at least once in a host/join session, if the peer connection fails, closes, or post-ready signaling fails because the connection is already closed, the CLI SHALL NOT exit the process solely for that reason. The CLI SHALL tear down the dead peer connection, display a clear waiting-to-reconnect status, and wait indefinitely for the same session PIN pairing to produce a new ready WebRTC session, unless the user cancels or a remote `bye` ends the session.

#### Scenario: Peer drop mid-download waits
- **WHEN** a download is in progress and the remote peer connection closes or a late signal fails with connection-closed
- **THEN** the CLI shows that it is waiting to reconnect
- **AND** the process remains running awaiting re-pair
- **AND** the CLI does not print a fatal `webrtc signal failed` / peer-connection-failed exit solely for that disconnect

#### Scenario: Same peer returns and transfers resume
- **WHEN** the CLI is waiting to reconnect and the same peer re-pairs and WebRTC becomes ready again
- **THEN** the CLI clears the waiting-to-reconnect status
- **AND** incomplete receives may resume from retained `.drop` partials per file-transfer requirements

#### Scenario: User cancel while waiting
- **WHEN** the CLI is waiting to reconnect and the user cancels (e.g. Ctrl+C / interactive quit)
- **THEN** the CLI exits the wait
- **AND** incomplete `.drop` partials are discarded per native cancel parity

#### Scenario: Different peer while waiting
- **WHEN** the CLI is waiting to reconnect and a different peer ID joins the same PIN and becomes ready
- **THEN** incomplete `.drop` partials from the prior peer are discarded
- **AND** the CLI proceeds with the new peer session

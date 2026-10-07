# CLI Session Specification

## Purpose

Provides interactive terminal navigation and non-interactive command-line controls for hosting, joining, file broadcasting, and receiving transfers within the Drop ecosystem.

## Requirements

### Requirement: Hardcoded pt-BR user-facing UI
The CLI SHALL present all user-facing text in Brazilian Portuguese (pt-BR), hardcoded with no locale switcher and no English UI fallback. User-facing text includes interactive forms, inbox/TUI chrome, connection and transfer status labels, copy feedback, flag help and usage text, quick-mode stdout/stderr lines intended for operators, and validation errors shown to the user. Where the same concept exists on Drop web/desktop, the CLI SHALL use the same user-visible name. Flag names, code identifiers, protocol fields, and brand tokens (`Drop`, `DropCli`) SHALL remain unchanged (English / as today).

#### Scenario: Shared terms match web/desktop
- **WHEN** the CLI shows device display name, download folder, download action, remove action, copy-code action, or settings labels
- **THEN** those labels use the same pt-BR names as web/desktop (`Nome de exibição`, `Pasta para downloads`, `Baixar`, `Remover`, `Copiar código`, `Configurações` as applicable)

#### Scenario: No English UI fallback
- **WHEN** a user runs interactive or quick mode without any locale flags
- **THEN** prompts, status lines, help/usage, and validation errors are shown in pt-BR
- **AND** the CLI does not offer a language switcher

#### Scenario: Non-UI surfaces stay English
- **WHEN** inspecting CLI source identifiers, flag names (e.g. `-s` / `-q` / `-c`), or wire protocol field names
- **THEN** those remain English / unchanged by this requirement

### Requirement: Simplified CLI argument surface
The CLI SHALL accept only these short launch flags: `-q` (skip interactive UI / quick mode), `-s` (host/share), `-c <pin>` (connect/join with PIN), `-o <dir>` (download/output directory), and `-h` (print usage and exit). Help SHALL also be available via the FlagSet help path (`-help` / `--help`). The CLI SHALL NOT accept removed flags or long aliases formerly used for the same options (`-f`, `-file`, `-d`, `-dir`, `-url`, `-name`, `--quick`, `--host`, `--connect`, `--output`, `--dir`, `--file`). Signaling URL SHALL NOT be settable via any CLI flag.

#### Scenario: Recognized flags parse
- **WHEN** the user runs `dropcli -q -s -o /tmp/out`
- **THEN** the CLI accepts the flags without error and starts as host in quick mode with download directory `/tmp/out`

#### Scenario: Host flag is -s not -h
- **WHEN** the user runs `dropcli -q -s`
- **THEN** the CLI starts as host
- **AND** when the user runs `dropcli -h` (or `-help` / `--help`) the CLI prints usage and exits without starting a session

#### Scenario: Unknown or removed flags rejected
- **WHEN** the user passes a removed flag such as `-f`, `-d`, `-url`, `-name`, or a long alias such as `--host`
- **THEN** the CLI exits with a non-zero status and shows an error / usage

### Requirement: Positional send paths
After flags, the CLI SHALL accept zero or more positional path arguments. Each positional SHALL be classified as a regular file or a directory (non-existent or unsupported path types SHALL cause a non-zero exit with a clear error before connecting when validation can detect them). Regular-file positionals SHALL be queued for send after the peer session is ready (send order unspecified). Directory positionals SHALL each enable recursive folder watching (same watch semantics as today) until the user cancels; multiple directories are allowed. Files and directories MAY be mixed in one invocation: file positionals are still sent once, and every directory is watched. When the positionals are files-only, after all queued files finish transferring successfully the process MAY exit (send-once). When any directory positional is present, the process SHALL remain running for watch (and MUST NOT exit solely because the one-shot file sends completed).

#### Scenario: Single file send
- **WHEN** the user runs `dropcli -q -s ./report.pdf`
- **THEN** after peer ready the CLI sends `report.pdf` and may exit after successful transfer completion

#### Scenario: Multiple files send then exit
- **WHEN** the user runs `dropcli -q -s a.txt b.txt c.txt`
- **THEN** after peer ready the CLI queues and sends all three files
- **AND** after those transfers complete successfully the CLI may exit
- **AND** send order among the files is not required to match argv order

#### Scenario: Directory watch
- **WHEN** the user runs `dropcli -q -s ./inbox`
- **AND** `./inbox` is a directory
- **THEN** the CLI recursively watches that directory tree and broadcasts new/changed files until the user cancels

#### Scenario: Mixed files and directories
- **WHEN** the user runs `dropcli -q -s ./a.txt ./inbox ./b.txt`
- **AND** `./inbox` is a directory and the other paths are files
- **THEN** after peer ready the CLI queues and sends `a.txt` and `b.txt`
- **AND** recursively watches `./inbox` until the user cancels
- **AND** does not exit solely because the one-shot file sends completed

### Requirement: Interactive launch with role or path flags
When `-q` is absent, the CLI SHALL present the full interactive UI (session chrome / receive inbox as applicable) even if `-s`, `-c`, `-o`, and/or positional paths are supplied. Supplied `-s` or `-c <pin>` SHALL select host or join without asking the mode prompt (join still uses the provided PIN and MUST validate it). Supplied `-o` SHALL set the download directory for the session. Positional send paths SHALL be queued for send after the interactive session becomes ready. Auto-download remains off without `-q` (manual inbox) per the auto-download toggle requirement.

#### Scenario: Host with UI without -q
- **WHEN** the user runs `dropcli -s`
- **THEN** the CLI hosts using the interactive session UI (not headless quick stdout-only mode)
- **AND** does not show the host/join mode selection prompt

#### Scenario: Join with UI and PIN
- **WHEN** the user runs `dropcli -c 1234`
- **THEN** the CLI joins with PIN `1234` using the interactive session UI
- **AND** announces manual download mode / shows the receive inbox for incoming files

#### Scenario: Paths without role open interactive queue
- **WHEN** the user runs `dropcli ./a.txt ./b.txt` with neither `-s` nor `-c`
- **THEN** the CLI starts the interactive flow (mode selection / settings as offered)
- **AND** after the user chooses host or join and the session is ready, those files are queued for send

### Requirement: Interactive mode startup
The CLI SHALL start an interactive terminal prompt when launched without `-q` and without `-s`/`-c` that already select a role, presenting clear options to generate a share code (`Gerar um código`), join with an existing code (`Possuo um código`), or open settings (`Configurações`) when that option is offered. Host and join option labels MUST match Drop web/desktop exactly: `Gerar um código` and `Possuo um código`. When positional paths are present without `-s`/`-c`, the CLI SHALL still offer this interactive role selection and retain the paths for send after connect. When `-s` or `-c` is present without `-q`, the CLI SHALL skip the mode prompt per the interactive launch with role or path flags requirement.

#### Scenario: User selects Host
- **WHEN** user launches the CLI without role-selecting flags and selects `Gerar um código`
- **THEN** the CLI transitions to the host waiting screen and requests a session PIN

#### Scenario: User selects Join
- **WHEN** user launches the CLI without role-selecting flags and selects `Possuo um código`
- **THEN** the CLI prompts the user for a session PIN code

#### Scenario: User opens config menu
- **WHEN** user launches the CLI without flags and selects `Configurações` (or the equivalent settings entry when offered)
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
While a host session PIN is known, the CLI SHALL let the user copy the 4-digit PIN with the `c` key and copy the Drop-compatible share URL with the `C` key (Shift+c). The share URL SHALL match Drop’s shape: `{origin}/share/?hostid={localPeerId}&code={pin}` where `{origin}` is the HTTPS origin derived from the configured signaling host (default `https://drop.lzart.com.br`). The CLI SHALL copy to the system clipboard and give brief UI feedback on success or failure in pt-BR (aligned with web/desktop copy-code wording such as `Copiar código` / copy acknowledged). The CLI SHALL NOT add a separate print-only share-link command; displaying the PIN as today remains sufficient on screen.

#### Scenario: Copy PIN with c
- **WHEN** the host has an assigned PIN and the user presses `c`
- **THEN** the 4-digit PIN is written to the system clipboard
- **AND** the UI acknowledges the copy in pt-BR

#### Scenario: Copy share link with C
- **WHEN** the host has an assigned PIN and a local peer ID, and the user presses `C`
- **THEN** a URL of the form `{origin}/share/?hostid={peerId}&code={pin}` is written to the system clipboard
- **AND** the UI acknowledges the copy in pt-BR

#### Scenario: Share origin follows signaling host
- **WHEN** the signaling WebSocket URL host is `drop.lzart.com.br` (default)
- **THEN** the share link origin is `https://drop.lzart.com.br`

#### Scenario: Keys unavailable without host PIN
- **WHEN** no host PIN is assigned yet (or the session is join-only without a local host code)
- **THEN** pressing `c` / `C` does not invent a PIN or share URL

### Requirement: Device identity configuration
The CLI SHALL allow setting a custom device display name via the interactive settings flow (`Configurações`) and/or persisted `~/.dropConfig`, defaulting to the local machine hostname when unspecified. The CLI SHALL NOT accept a launch flag for device name.

#### Scenario: Custom device name provided
- **WHEN** the user specifies a device name via the interactive settings form or persisted config
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
- **AND** incoming files appear in the receive inbox for `Baixar` or `Remover`

#### Scenario: Settings form has no auto-download control
- **WHEN** the user opens interactive settings configuration
- **THEN** the form does not include an Auto-download toggle

#### Scenario: Config does not persist auto-download
- **WHEN** the CLI writes `~/.dropConfig`
- **THEN** the file does not store an auto-download preference
- **AND** a legacy `autoDownload` field in an existing file is ignored on load and omitted on the next save

### Requirement: Interactive receive inbox
When the CLI runs in interactive mode (no `-q`) and a WebRTC session is ready, the CLI SHALL present a live inbox of remote files announced via `meta` that have not yet been downloaded or dismissed. Each pending entry SHALL offer actions to download (`Baixar`) that file and to remove/dismiss (`Remover`) that file. The inbox SHALL update as new announcements arrive and as downloads complete or items are removed. The CLI process SHALL remain in the session until the user cancels or the peer sends `bye`. Unexpected transport failure after ready SHALL enter wait-to-reconnect rather than ending the interactive session by itself. Inbox chrome and action hints SHALL be in pt-BR per the hardcoded pt-BR user-facing UI requirement.

#### Scenario: Pending file appears in inbox
- **WHEN** the interactive CLI is connected and the remote peer announces a file with `meta`
- **THEN** the inbox lists that file (name and size at minimum) with `Baixar` and `Remover` actions
- **AND** the file is not written to disk until the user chooses `Baixar`

#### Scenario: Download from inbox
- **WHEN** the user selects `Baixar` on a pending inbox item
- **THEN** the CLI requests that file from the peer and writes it to the configured download directory
- **AND** progress for that transfer is visible in the interactive session

#### Scenario: Remove from inbox
- **WHEN** the user selects `Remover` on a pending inbox item
- **THEN** the item leaves the inbox without downloading
- **AND** the peer is notified so the offer is no longer treated as awaiting pull
- **AND** any `.drop` partial for that offer is discarded

#### Scenario: Quick mode has no inbox
- **WHEN** the user runs with `-q`
- **THEN** the CLI does not present the interactive receive inbox
- **AND** incoming files are auto-downloaded per quick-mode receive behavior

#### Scenario: Peer leave returns to wait reconnect
- **WHEN** interactive mode had a ready session and the peer transport fails
- **THEN** the CLI shows waiting-to-reconnect status in pt-BR and keeps the process alive for re-pair
- **AND** does not exit solely due to that transport failure

### Requirement: Quick receive session persistence
When quick mode connects without positional send paths (receive/wait mode), the CLI SHALL remain in the session after WebRTC becomes ready until the user cancels (e.g. Ctrl+C) or the peer sends a `bye` control message. An inbound `batch-done` MUST NOT terminate this wait loop by itself. Unexpected signaling/WebRTC transport failure after ready SHALL enter wait-to-reconnect indefinitely rather than exiting the process.

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
- **WHEN** the CLI runs quick mode with one or more file positionals
- **THEN** after those file transfers and outbound `batch-done`, the CLI may exit as today if the send completed successfully
- **AND** if the peer drops mid-send before completion, the CLI waits to reconnect and retries/resumes rather than exiting as success
- **AND** when any directory positional is present, watch continues until user cancel (including after one-shot file sends complete)

### Requirement: Quick mode command-line execution
The CLI SHALL support non-interactive (`-q`) command-line execution to host (`-s`) or join (`-c <pin>`), send positional files and/or watch positional directories (including mixed), and set a custom output folder (`-o`) without interactive prompts. Host or join without positional send/watch paths SHALL enter receive/wait mode and remain connected per the quick receive session persistence requirement (including wait-to-reconnect after post-ready transport failure). Quick mode SHALL require `-s` or `-c`.

#### Scenario: Quick mode host with files
- **WHEN** user runs with `-q -s ./path/to/file`
- **THEN** the CLI starts as host, displays the assigned PIN, queues the specified file for transfer, and exits after successful transfer completion

#### Scenario: Quick mode join with PIN
- **WHEN** user runs with `-q -c <pin>`
- **THEN** the CLI connects directly to the specified host PIN without interactive prompt
- **AND** if no positional send paths are set, the CLI enters receive/wait mode and stays until cancel, `bye`, or successful completion paths defined elsewhere — not solely on transient transport failure after ready

#### Scenario: Quick mode host receive wait
- **WHEN** user runs with `-q -s` and no positional send paths
- **THEN** the CLI hosts, waits for a peer, and after WebRTC ready stays available for incoming files until cancel or `bye`, waiting to reconnect across transient peer drops

#### Scenario: Quick mode with custom output directory
- **WHEN** user runs with `-q -c <pin> -o <path>` or `-o <path>`
- **THEN** the CLI sets `<path>` as the destination directory for downloaded files instead of the current working directory

#### Scenario: Missing required flags in quick mode
- **WHEN** user runs with `-q` but provides neither `-s` nor `-c`
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

### Requirement: Left-aligned host-wait terminal lines
While the host is waiting for a peer and showing the assigned PIN (including copy hints and copy success/failure feedback), each new status line printed to the terminal SHALL begin at column 0. Lines MUST NOT cascade rightward (staircase indent) across successive messages on a TTY.

#### Scenario: PIN and copy hint stay left-aligned
- **WHEN** the signaling server assigns a host PIN and the CLI prints the PIN and the copy-key hint on a TTY
- **THEN** each of those lines starts at the left margin of the terminal

#### Scenario: Copy feedback stays left-aligned
- **WHEN** the host presses `c` or `C` during PIN wait and the CLI prints copy success or failure feedback on a TTY
- **THEN** each feedback line starts at the left margin of the terminal

### Requirement: Ctrl+C confirm-to-exit overlay
On a TTY, when the user presses Ctrl+C (or equivalent interrupt) during any session wait surface — host PIN wait, quick receive/wait, wait-to-reconnect, or interactive inbox — the CLI SHALL NOT exit on that first press. Instead it SHALL show a full-viewport (alt-screen) overlay in pt-BR that tells the user to press Ctrl+C again to exit or press ESC to continue. While the overlay is visible, a second Ctrl+C SHALL confirm exit; ESC SHALL dismiss the overlay and resume the prior wait UI (including host copy-key actions when that surface is active). Non-TTY / non-interactive runs are out of scope for this overlay.

#### Scenario: First Ctrl+C shows confirm overlay on host PIN wait
- **WHEN** the CLI is hosting and waiting for a peer on a TTY and the user presses Ctrl+C once
- **THEN** a full-viewport overlay appears in pt-BR instructing the user to press Ctrl+C again to exit or ESC to continue
- **AND** the session wait does not end solely because of that first press

#### Scenario: First Ctrl+C shows confirm overlay on receive wait
- **WHEN** the CLI is in quick receive/wait mode on a TTY and the user presses Ctrl+C once
- **THEN** the same confirm overlay appears and the receive wait does not end solely because of that first press

#### Scenario: First Ctrl+C shows confirm overlay while waiting to reconnect
- **WHEN** the CLI is waiting to reconnect on a TTY and the user presses Ctrl+C once
- **THEN** the same confirm overlay appears and the wait-to-reconnect does not end solely because of that first press

#### Scenario: First Ctrl+C shows confirm overlay in interactive inbox
- **WHEN** the interactive inbox is showing on a TTY and the user presses Ctrl+C once
- **THEN** the same confirm overlay appears and the inbox session does not end solely because of that first press

#### Scenario: ESC dismisses overlay and continues
- **WHEN** the confirm overlay is visible and the user presses ESC
- **THEN** the overlay closes
- **AND** the prior wait UI resumes
- **AND** host copy keys `c` / `C` remain available when the resumed surface is host PIN wait

#### Scenario: Second Ctrl+C confirms exit
- **WHEN** the confirm overlay is visible and the user presses Ctrl+C again
- **THEN** the session ends and the process shuts down

### Requirement: Clean exit on intentional user cancel
When the process ends because the user confirmed cancel (second Ctrl+C on the confirm overlay, or equivalent confirmed interrupt leading to a canceled run context), the CLI SHALL treat that as a successful user-initiated exit: it MUST NOT print `erro: context canceled` (or equivalent operator-error framing of `context.Canceled`) on stderr, and MUST NOT exit with a non-zero status solely for that cancel. Confirmed cancel MAY be silent (no goodbye line).

#### Scenario: Confirmed Ctrl+C does not print context canceled error
- **WHEN** the user confirms exit with a second Ctrl+C on the overlay and the run ends only because the context was canceled
- **THEN** stderr does not contain `erro: context canceled`
- **AND** the process exit status is zero

#### Scenario: Real errors still report as erro
- **WHEN** the CLI fails for a reason other than intentional user cancel
- **THEN** the CLI still prints `erro:` with the failure and exits non-zero as today

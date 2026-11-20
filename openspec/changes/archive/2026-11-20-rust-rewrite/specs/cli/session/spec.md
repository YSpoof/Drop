# Spec Delta

## MODIFIED Requirements

### Requirement: Hardcoded pt-BR user-facing UI
The CLI SHALL present all user-facing text in Brazilian Portuguese (pt-BR), hardcoded with no locale switcher and no English UI fallback. User-facing text includes interactive forms, inbox/TUI chrome, connection and transfer status labels (including peer-loss transfer failure reasons), copy feedback, flag help and usage text, quick-mode stdout/stderr lines intended for operators, and validation errors shown to the user. Where the same concept exists on Drop web/desktop, the CLI SHALL use the same user-visible name. Flag names, code identifiers, protocol fields, and brand tokens (`Drop`, `DropCli`) SHALL remain unchanged (English / as today).

#### Scenario: Shared terms match web/desktop
- **WHEN** the CLI shows device display name, download folder, download action, remove action, copy-code action, or settings labels
- **THEN** those labels use the same pt-BR names as web/desktop (`Nome de exibição`, `Pasta para downloads`, `Baixar`, `Remover`, `Copiar código`, `Configurações` as applicable)

#### Scenario: No English UI fallback
- **WHEN** a user runs interactive or quick mode without any locale flags
- **THEN** prompts, status lines, help/usage, and validation errors are shown in pt-BR
- **AND** the CLI does not offer a language switcher

#### Scenario: Non-UI surfaces stay English
- **WHEN** inspecting CLI source identifiers, flag names (e.g. `--host` / `--quick` / `--code`), or wire protocol field names
- **THEN** those remain English / unchanged by this requirement

#### Scenario: Peer-loss transfer reason is pt-BR
- **WHEN** a receive transfer is interrupted because the peer connection was lost
- **THEN** the transfer list shows the failure reason `conexão perdida`
- **AND** does not show the English string `peer lost`

### Requirement: Positional send paths
The CLI SHALL accept zero or more positional path arguments, before or after flags. Each positional SHALL be classified as a regular file or a directory (non-existent or unsupported path types SHALL cause a non-zero exit with a clear error before connecting when validation can detect them). Regular-file positionals SHALL be queued for send after the peer session is ready (send order unspecified). Directory positionals SHALL each enable recursive folder watching (same watch semantics as today) until the user cancels; multiple directories are allowed. Files and directories MAY be mixed in one invocation: file positionals are still sent once, and every directory is watched. When the positionals are files-only, after all queued files finish transferring successfully the process MAY exit (send-once). When any directory positional is present, the process SHALL remain running for watch (and MUST NOT exit solely because the one-shot file sends completed).

#### Scenario: Single file send
- **WHEN** the user runs `dropcli --quick --host ./report.pdf`
- **THEN** after peer ready the CLI sends `report.pdf` and may exit after successful transfer completion

#### Scenario: Multiple files send then exit
- **WHEN** the user runs `dropcli --quick --host a.txt b.txt c.txt`
- **THEN** after peer ready the CLI queues and sends all three files
- **AND** after those transfers complete successfully the CLI may exit
- **AND** send order among the files is not required to match argv order

#### Scenario: Directory watch
- **WHEN** the user runs `dropcli --quick --host ./inbox`
- **AND** `./inbox` is a directory
- **THEN** the CLI recursively watches that directory tree and broadcasts new/changed files until the user cancels

#### Scenario: Mixed files and directories
- **WHEN** the user runs `dropcli --quick --host ./a.txt ./inbox ./b.txt`
- **AND** `./inbox` is a directory and the other paths are files
- **THEN** after peer ready the CLI queues and sends `a.txt` and `b.txt`
- **AND** recursively watches `./inbox` until the user cancels
- **AND** does not exit solely because the one-shot file sends completed

### Requirement: Interactive mode startup
The CLI SHALL start an interactive terminal prompt when launched without `--quick` and without `--host`/`--code` that already select a role, presenting three options: generate a share code (`Gerar um código`), join with an existing code (`Possuo um código`), and open settings (`Configurações`). Host and join option labels MUST match Drop web/desktop exactly: `Gerar um código` and `Possuo um código`. Choosing host or join SHALL proceed to the session without asking for display name or download folder. Closing `Configurações` SHALL return to this prompt. When positional paths are present without `--host`/`--code`, the CLI SHALL still offer this interactive role selection and retain the paths for send after connect. When `--host` or `--code` is present without `--quick`, the CLI SHALL skip the mode prompt per the interactive launch with role flags or paths requirement.

#### Scenario: User selects Host
- **WHEN** user launches the CLI without role-selecting flags and selects `Gerar um código`
- **THEN** the CLI transitions to the host waiting screen and requests a session PIN
- **AND** the CLI does not ask for display name or download folder first

#### Scenario: User selects Join
- **WHEN** user launches the CLI without role-selecting flags and selects `Possuo um código`
- **THEN** the CLI prompts the user for a session PIN code
- **AND** the CLI does not ask for display name or download folder

#### Scenario: User opens config menu
- **WHEN** user launches the CLI without flags and selects `Configurações`
- **THEN** the CLI presents a settings form with the current persisted device name, download directory, the persisted transfer totals with a reset-stats option, and the project PIX key with a copy control
- **AND** the form does not include an auto-download control

#### Scenario: Saving settings returns to the menu
- **WHEN** the user changes the device name or download directory in `Configurações` and confirms
- **THEN** the new values are written to `~/.dropConfig`
- **AND** the mode prompt is shown again

### Requirement: Download directory configuration
The CLI SHALL save received files into the download directory chosen in this order: the `--out <dir>` value of the current run, else the directory persisted from `Configurações`, else the current working directory. `--out` MUST NOT change the persisted directory. The CLI MUST NOT persist the current working directory merely because it was used as the default. Clearing the folder in `Configurações` SHALL remove the persisted directory.

#### Scenario: Custom download directory provided
- **WHEN** user configures a target directory path in `Configurações`
- **THEN** incoming downloaded files are saved into that directory on this and later runs

#### Scenario: Default directory fallback
- **WHEN** no download directory is configured and `--out` is absent
- **THEN** incoming downloaded files are saved into the current working directory

#### Scenario: --out is scoped to one run
- **WHEN** the user runs the CLI with `--out /tmp/a` and later runs it again without `--out`
- **THEN** the first run saves into `/tmp/a`
- **AND** the second run does not use `/tmp/a` unless it is the persisted directory or the current working directory

#### Scenario: Default is not pinned
- **WHEN** nothing is persisted and the user runs the CLI in directory A, then again in directory B
- **THEN** the first run saves into A and the second run saves into B

### Requirement: Auto-download toggle
Auto-download SHALL be derived only from launch mode: quick mode (`--quick`) always auto-downloads incoming files; interactive mode (no `--quick`) always uses manual receive (inbox). The CLI SHALL NOT persist an auto-download preference in `~/.dropConfig`. The interactive settings flow SHALL NOT expose an Auto-download toggle.

#### Scenario: Quick mode auto-download
- **WHEN** the user runs with `--quick` and a peer sends files
- **THEN** announced files are downloaded automatically without an inbox UI

#### Scenario: Interactive mode manual receive
- **WHEN** the user runs without `--quick` and connects a session
- **THEN** the CLI announces manual download mode to the peer
- **AND** incoming files appear in the receive inbox for `Baixar` or `Remover`

#### Scenario: Settings form has no auto-download control
- **WHEN** the user opens interactive settings configuration
- **THEN** the form does not include an Auto-download toggle

#### Scenario: Config does not persist auto-download
- **WHEN** the CLI writes `~/.dropConfig`
- **THEN** the file does not store an auto-download preference
- **AND** a legacy `autoDownload` field in an existing file is ignored on load and omitted on the next save

### Requirement: Incoming-file search with f
While the interactive inbox is active (and not on the Ctrl+C confirm overlay), pressing `f` SHALL enter search mode over pending offers (case-insensitive partial filename match against `meta.name` / visible row names). Matching SHALL filter or navigate to matching rows without overflowing the pending panel. ↑/↓ SHALL move among search results. Esc SHALL leave search mode and restore normal navigation. Enter in search mode SHALL confirm the current result and return to normal navigation without downloading. Footer hints SHALL advertise `f` for search while browsing; during search the footer SHALL show search-relevant hints instead of the full browse set. While search mode is active, every printable character typed (including `a`, `c`, `C`, `d`, `q`, `r`, `x`, and Space) SHALL be appended to the query and MUST NOT trigger its browse-mode action; those actions SHALL be available again once Enter or Esc leaves search mode.

#### Scenario: f opens search
- **WHEN** the inbox is browsing pending offers and the user presses `f`
- **THEN** the UI enters search mode with an input for the query
- **AND** footer hints reflect search mode

#### Scenario: Case-insensitive partial match
- **WHEN** pending offers include `Ubuntu-24.04.iso` and the user types `ubuntu` in search
- **THEN** that offer appears among the search results

#### Scenario: Esc leaves search
- **WHEN** search mode is active and the user presses Esc
- **THEN** the inbox returns to normal browsing without quitting the session

#### Scenario: Enter in search does not download
- **WHEN** search mode is active with a highlighted result and the user presses Enter
- **THEN** the inbox exits search focusing that result (or equivalent confirm)
- **AND** no pull / download starts solely because Enter was pressed

#### Scenario: Action letters go into the query
- **WHEN** search mode is active and the user types `readme x`
- **THEN** the query is `readme x`
- **AND** no offer is downloaded or dismissed, nothing is copied, and the session does not quit because of those keystrokes

### Requirement: Cross-screen interactive visual consistency
Mode selection, PIN entry, settings, donation reminder, host PIN wait / reconnect status, confirm overlay, and the receive inbox SHALL share a consistent visual language (title/header emphasis, dim secondary text, semantic status colors, bordered or sectioned panels where the surface is a full-screen TUI). Forms and notes SHALL adopt matching titles, emphasis, and pt-BR copy tone so they do not feel like a different product. No new help overlay (`?`) is required; discoverability remains via on-screen footer/hints.

#### Scenario: Form screens match chrome tone
- **WHEN** the user opens mode selection, settings, or the donation reminder in interactive mode
- **THEN** titles and secondary text follow the same emphasis hierarchy and pt-BR wording rules as the inbox chrome

### Requirement: Host inbox keybindings after session ready
When the CLI hosts in interactive mode and the receive inbox is shown after a WebRTC session is ready, the CLI SHALL deliver inbox keyboard actions to the inbox UI without echoing those keystrokes as ordinary cooked terminal input. Bound keys (↑/↓ navigation including folder Enter/Esc up, mark/select-all, download via `d` only, remove/dismiss via `r`/`x`, incoming-file search via `f`, copy PIN / share link when a host PIN is known via `c`/`C`, and quit via `q`) MUST perform their documented actions while browsing; in search mode printable keys edit the query per the incoming-file search requirement. Enter MUST NOT download (except that in search mode Enter confirms the search result and returns to browsing without downloading). The CLI SHALL NOT treat `j` or `k` as navigation aliases. This SHALL hold immediately after the first peer connect that ends host PIN wait, and again whenever the host inbox is active after a successful reconnect. The CLI MUST NOT leave the TTY in a state where typed characters appear as literal text under the inbox chrome instead of being handled as keybindings. Joiner inbox behavior is unchanged by this requirement except that the same inbox keybindings apply when the joiner inbox is active.

#### Scenario: Host inbox keys work right after peer connect
- **WHEN** the CLI hosts in interactive mode, shows the PIN wait UI, a peer connects, and the receive inbox becomes active
- **THEN** pressing documented inbox keys (↑/↓, Space, a, d, r, f, Enter, Esc, c/C when PIN known, q) performs those inbox actions
- **AND** those keystrokes do not accumulate as echoed plain text under the inbox chrome
- **AND** pressing `j` or `k` does not move the inbox cursor

#### Scenario: Host inbox keys still work after reconnect
- **WHEN** the host interactive inbox was active, the peer transport fails, the CLI waits to reconnect, and a new ready session returns to the inbox
- **THEN** inbox keybindings continue to perform their actions without cooked-text echo under the chrome

### Requirement: Interactive receive inbox
When the CLI runs in interactive mode (no `--quick`) and a WebRTC session is ready, the CLI SHALL present a live inbox of remote files announced via `meta` that have not yet been downloaded or dismissed, using the responsive dashboard layout, scrollable pending list, compact transfer rows, compact header (including optional LAN badge), and dedicated empty states defined by this change. The pending section SHALL present those offers as a path-segment folder tree derived from each offer’s `meta.name` (forward slashes): at the current directory level the inbox lists only immediate child folders and files, with a leading `..` row when the current level is not the tree root. Cursor and selection SHALL remain visually distinct (cursor marker vs `[ ]`/`[x]`/`[-]` selection; folder rows use `[-]` when some but not all descendant files are selected). Each pending file entry SHALL offer actions to download (`Baixar` / `d`) that file and to remove/dismiss (`Remover`) that file. Folder rows MAY be selected; selecting a folder selects all pending files under that folder recursively, and `d` / `r` on a folder (or with that folder selected) SHALL pull or dismiss those descendant files. Enter SHALL enter the highlighted folder or follow `..`, and MUST be a no-op on a file; Enter MUST NOT download. Esc SHALL move up one directory level and MUST be a no-op at the tree root (except when dismissing the Ctrl+C confirm overlay or leaving search mode). When hosting, those actions SHALL be operable via the inbox keybindings defined by the host inbox keybindings after session ready requirement (not only via non-keyboard means). The inbox SHALL update as new announcements arrive and as downloads complete or items are removed. When an announced file matches a retained incomplete `.drop` per the auto-resume incomplete receive on matching hash requirement, the CLI SHALL auto-start that download and MUST NOT require the user to choose `Baixar` for that offer. The transfers section SHALL keep history small by consolidating rows for the same identity hash when a peer-loss failure is resumed. The CLI process SHALL remain in the session until the user cancels or the peer sends `bye`. Unexpected transport failure after ready SHALL enter wait-to-reconnect rather than ending the interactive session by itself. Inbox chrome and action hints SHALL be in pt-BR per the hardcoded pt-BR user-facing UI requirement. Help remains footer-only (no `?` overlay).

#### Scenario: Pending file appears in inbox
- **WHEN** the interactive CLI is connected and the remote peer announces a file with `meta` that is not eligible for auto-resume
- **THEN** the inbox lists that file (name and size at minimum) with `Baixar` and `Remover` actions
- **AND** the file is not written to disk until the user chooses `Baixar`

#### Scenario: Nested offers show as folders
- **WHEN** pending offers include `photos/a.jpg` and `photos/nested/b.jpg`
- **THEN** at the inbox tree root the pending list shows a `photos` folder row (not both files as root rows)
- **AND** entering `photos` lists `a.jpg`, a `nested` folder, and a leading `..` row

#### Scenario: Enter enters folder and never downloads
- **WHEN** the cursor is on a folder row and the user presses Enter
- **THEN** the inbox navigates into that folder and lists its immediate children with `..` on top
- **AND** no pull / download starts solely because Enter was pressed

#### Scenario: Enter on file is a no-op
- **WHEN** the cursor is on a file row and the user presses Enter
- **THEN** the inbox does not download, dismiss, or change directory

#### Scenario: Esc goes up one level
- **WHEN** the inbox current directory is not the tree root and the user presses Esc (and the Ctrl+C confirm overlay is not showing and search mode is not active)
- **THEN** the inbox navigates to the parent directory level

#### Scenario: Esc at root is a no-op
- **WHEN** the inbox is at the tree root and the user presses Esc (and the Ctrl+C confirm overlay is not showing and search mode is not active)
- **THEN** the inbox stays at the root and the session does not end solely because of that press

#### Scenario: Download from inbox
- **WHEN** the user selects `Baixar` (`d`) on a pending inbox file item
- **THEN** the CLI requests that file from the peer and writes it to the configured download directory under the announced relative path (or a unique collision-safe variant)
- **AND** progress for that transfer is visible in the interactive session

#### Scenario: Download folder from inbox
- **WHEN** the user selects `Baixar` (`d`) on a folder row (or with that folder selected and no other selection overriding the target set)
- **THEN** the CLI requests every pending file under that folder recursively
- **AND** each completed file is written under the download directory preserving the announced relative path segments

#### Scenario: Remove from inbox
- **WHEN** the user selects `Remover` on a pending inbox file item
- **THEN** the item leaves the inbox without downloading
- **AND** the peer is notified so the offer is no longer treated as awaiting pull
- **AND** any `.drop` partial for that offer is discarded

#### Scenario: Remove folder from inbox
- **WHEN** the user selects `Remover` on a folder row (or with that folder selected in the target set)
- **THEN** every pending file under that folder leaves the inbox without downloading
- **AND** the peer is notified for each dismissed offer

#### Scenario: Auto-resume after peer reconnect
- **WHEN** interactive mode lost the peer mid-download with a retained `.drop`, the peer reconnects, and re-announces the same identity hash
- **THEN** the CLI starts the download without the user pressing `Baixar`
- **AND** the transfers section shows one in-progress row for that file (not a failed row plus a separate active row)

#### Scenario: Quick mode has no inbox
- **WHEN** the user runs with `--quick`
- **THEN** the CLI does not present the interactive receive inbox
- **AND** incoming files are auto-downloaded per quick-mode receive behavior

#### Scenario: Peer leave returns to wait reconnect
- **WHEN** interactive mode had a ready session and the peer transport fails
- **THEN** the CLI shows waiting-to-reconnect status in pt-BR and keeps the process alive for re-pair
- **AND** does not exit solely due to that transport failure

### Requirement: Quick mode command-line execution
The CLI SHALL support non-interactive (`--quick`) command-line execution to host (`--host`) or join (`--code <pin>`), send positional files and/or watch positional directories (including mixed), and set a custom output folder (`--out`) without interactive prompts. Host or join without positional send/watch paths SHALL enter receive/wait mode and remain connected per the quick receive session persistence requirement (including wait-to-reconnect after post-ready transport failure). Quick mode SHALL require `--host` or `--code`.

#### Scenario: Quick mode host with files
- **WHEN** user runs with `--quick --host ./path/to/file`
- **THEN** the CLI starts as host, displays the assigned PIN, queues the specified file for transfer, and exits after successful transfer completion

#### Scenario: Quick mode join with PIN
- **WHEN** user runs with `--quick --code <pin>`
- **THEN** the CLI connects directly to the specified host PIN without interactive prompt
- **AND** if no positional send paths are set, the CLI enters receive/wait mode and stays until cancel, `bye`, or successful completion paths defined elsewhere — not solely on transient transport failure after ready

#### Scenario: Quick mode host receive wait
- **WHEN** user runs with `--quick --host` and no positional send paths
- **THEN** the CLI hosts, waits for a peer, and after WebRTC ready stays available for incoming files until cancel or `bye`, waiting to reconnect across transient peer drops

#### Scenario: Quick mode with custom output directory
- **WHEN** user runs with `--quick --code <pin> --out <path>` or `--out <path>`
- **THEN** the CLI sets `<path>` as the destination directory for downloaded files instead of the current working directory

#### Scenario: Missing required flags in quick mode
- **WHEN** user runs with `--quick` but provides neither `--host` nor `--code`
- **THEN** the CLI exits with a non-zero status code and displays usage instructions

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
- **AND** incomplete `.drop` partials are discarded per desktop cancel parity

#### Scenario: Different peer while waiting
- **WHEN** the CLI is waiting to reconnect and a different peer ID joins the same PIN and becomes ready
- **THEN** incomplete `.drop` partials from the prior peer are discarded
- **AND** the CLI proceeds with the new peer session

## ADDED Requirements

### Requirement: Long-form CLI argument surface
The CLI SHALL accept only these launch flags, each in double-dash long form: `--quick` (quick mode, no interactive UI), `--host` (host/share), `--code <pin>` (join with PIN), `--out <dir>` (download directory for this run), and `--help` (print usage and exit). Single-dash flags and any other flag MUST be rejected. Flags MAY appear before, between, or after positional paths. Signaling URL SHALL NOT be settable via any CLI flag.

#### Scenario: Recognized flags parse
- **WHEN** the user runs `dropcli --quick --host --out /tmp/out`
- **THEN** the CLI accepts the flags without error and starts as host in quick mode with download directory `/tmp/out`

#### Scenario: Help prints usage
- **WHEN** the user runs `dropcli --help`
- **THEN** the CLI prints usage in pt-BR and exits with status zero without starting a session

#### Scenario: Flags after paths
- **WHEN** the user runs `dropcli --quick --host ./a.txt --out /tmp/out`
- **THEN** `--out /tmp/out` is parsed as a flag
- **AND** `./a.txt` is the only positional path

#### Scenario: Single-dash flags rejected
- **WHEN** the user passes `-q`, `-s`, `-c 1234`, `-o dir`, `-h`, or `-help`
- **THEN** the CLI exits with a non-zero status and shows an error / usage

#### Scenario: Unknown or removed flags rejected
- **WHEN** the user passes a removed flag such as `-f`, `-d`, `-url`, `-name`, or a long alias such as `--connect` or `--output`
- **THEN** the CLI exits with a non-zero status and shows an error / usage

### Requirement: Interactive launch with role flags or paths
When `--quick` is absent, the CLI SHALL present the full interactive UI even if `--host`, `--code`, `--out`, and/or positional paths are supplied. `--host` or `--code <pin>` SHALL select host or join without the mode prompt; the PIN MUST be validated. `--out` SHALL set the download directory for the session. Positional paths SHALL be queued for send once the session is ready. Auto-download stays off without `--quick`, per the auto-download toggle requirement.

#### Scenario: Host with UI without --quick
- **WHEN** the user runs `dropcli --host`
- **THEN** the CLI hosts using the interactive session UI (not headless quick stdout-only mode)
- **AND** does not show the host/join mode selection prompt

#### Scenario: Join with UI and PIN
- **WHEN** the user runs `dropcli --code 1234`
- **THEN** the CLI joins with PIN `1234` using the interactive session UI
- **AND** announces manual download mode / shows the receive inbox for incoming files

#### Scenario: Paths without role open interactive queue
- **WHEN** the user runs `dropcli ./a.txt ./b.txt` with neither `--host` nor `--code`
- **THEN** the CLI starts the interactive flow (mode selection / settings as offered)
- **AND** after the user chooses host or join and the session is ready, those files are queued for send

### Requirement: Clean exit on confirmed user cancel
When the process ends because the user confirmed cancel (second Ctrl+C on the confirm overlay, or an equivalent confirmed interrupt), the CLI SHALL treat that as a successful user-initiated exit: it MUST NOT print an `erro:` line for that cancel on stderr, and MUST NOT exit with a non-zero status solely for that cancel. Confirmed cancel MAY be silent (no goodbye line).

#### Scenario: Confirmed Ctrl+C prints no error
- **WHEN** the user confirms exit with a second Ctrl+C on the overlay and the run ends only because of that cancel
- **THEN** stderr does not contain an `erro:` line
- **AND** the process exit status is zero

#### Scenario: Real errors still report as erro
- **WHEN** the CLI fails for a reason other than intentional user cancel
- **THEN** the CLI still prints `erro:` with the failure and exits non-zero as today

### Requirement: Persisted transfer statistics
The CLI SHALL keep running totals of uploaded bytes, downloaded bytes, uploaded files, and downloaded files in `~/.dropConfig`. Each successfully completed transfer SHALL be added to the totals, and the totals SHALL survive process exit. `Configurações` SHALL show the totals and offer a reset that sets all four to zero.

#### Scenario: Completed download is counted
- **WHEN** a received file is finalized on disk and the CLI later exits and starts again
- **THEN** the persisted downloaded-bytes total has grown by that file's size and the downloaded-files total by one

#### Scenario: Failed transfer is not counted
- **WHEN** a transfer fails, is cancelled, or is interrupted by peer loss
- **THEN** the persisted totals do not change because of that transfer

#### Scenario: Reset clears the totals
- **WHEN** the user confirms the reset-stats option in `Configurações`
- **THEN** all four persisted totals are zero

### Requirement: Corrupt config is preserved
When `~/.dropConfig` exists but cannot be parsed, the CLI SHALL start with default settings and, before its first write to that path, SHALL copy the unreadable file to `~/.dropConfig.bak`. A missing config file MUST NOT produce a backup.

#### Scenario: Corrupt file is backed up
- **WHEN** `~/.dropConfig` contains invalid data and the CLI starts
- **THEN** the CLI runs with default settings
- **AND** `~/.dropConfig.bak` holds the original invalid content after the CLI writes its config

#### Scenario: Missing file has no backup
- **WHEN** `~/.dropConfig` does not exist and the CLI starts
- **THEN** no `~/.dropConfig.bak` is created

## REMOVED Requirements

### Requirement: Simplified CLI argument surface

**Reason**: Restated under a new name because its scenarios are renamed for the long-only flags and no longer mention Go runtime terms.

**Migration**: See the long-form CLI argument surface requirement. Replace `-q`, `-s`, `-c`, `-o`, `-h` with `--quick`, `--host`, `--code`, `--out`, `--help`.

### Requirement: Interactive launch with role or path flags

**Reason**: Restated under a new name because its scenarios are renamed for the long-only flags and no longer mention Go runtime terms.

**Migration**: See the interactive launch with role flags or paths requirement; behavior is the same with the long flags.

### Requirement: Clean exit on intentional user cancel

**Reason**: Restated under a new name because its scenarios are renamed for the long-only flags and no longer mention Go runtime terms.

**Migration**: See the clean exit on confirmed user cancel requirement; behavior is the same.

# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Device identity configuration
The CLI SHALL allow setting a custom device display name via the interactive settings flow (`Configurações`) and/or persisted `~/.dropConfig`, defaulting to the local machine hostname when unspecified. The CLI SHALL NOT accept a launch flag for device name.

#### Scenario: Custom device name provided
- **WHEN** the user specifies a device name via the interactive settings form or persisted config
- **THEN** the CLI announces this display name to signaling and remote peers

#### Scenario: Default hostname used
- **WHEN** no custom device name is specified
- **THEN** the CLI retrieves and announces the local machine hostname

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

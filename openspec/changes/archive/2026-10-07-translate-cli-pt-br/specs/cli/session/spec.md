# Spec Delta

## ADDED Requirements

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
- **WHEN** inspecting CLI source identifiers, flag names (e.g. `-h` / `--host`), or wire protocol field names
- **THEN** those remain English / unchanged by this requirement

## MODIFIED Requirements

### Requirement: Interactive mode startup
The CLI SHALL start an interactive terminal prompt when launched without execution flags, presenting clear options to generate a share code (`Gerar um código`), join with an existing code (`Possuo um código`), or open settings (`Configurações`) when that option is offered. Host and join option labels MUST match Drop web/desktop exactly: `Gerar um código` and `Possuo um código`.

#### Scenario: User selects Host
- **WHEN** user launches the CLI without flags and selects `Gerar um código`
- **THEN** the CLI transitions to the host waiting screen and requests a session PIN

#### Scenario: User selects Join
- **WHEN** user launches the CLI without flags and selects `Possuo um código`
- **THEN** the CLI prompts the user for a session PIN code

#### Scenario: User opens config menu
- **WHEN** user launches the CLI without flags and selects `Configurações` (or the equivalent settings entry when offered)
- **THEN** the CLI presents a settings form with the current persisted device name, download directory, and a reset-stats option
- **AND** the form does not include an auto-download control

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

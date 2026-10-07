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
- **WHEN** inspecting CLI source identifiers, flag names (e.g. `-s` / `-q` / `-c`), or wire protocol field names
- **THEN** those remain English / unchanged by this requirement

#### Scenario: Peer-loss transfer reason is pt-BR
- **WHEN** a receive transfer is interrupted because the peer connection was lost
- **THEN** the transfer list shows the failure reason `conexão perdida`
- **AND** does not show the English string `peer lost`

### Requirement: Interactive receive inbox
When the CLI runs in interactive mode (no `-q`) and a WebRTC session is ready, the CLI SHALL present a live inbox of remote files announced via `meta` that have not yet been downloaded or dismissed. Each pending entry SHALL offer actions to download (`Baixar`) that file and to remove/dismiss (`Remover`) that file. When hosting, those actions SHALL be operable via the inbox keybindings defined by the host inbox keybindings after session ready requirement (not only via non-keyboard means). The inbox SHALL update as new announcements arrive and as downloads complete or items are removed. When an announced file matches a retained incomplete `.drop` per the auto-resume incomplete receive on matching hash requirement, the CLI SHALL auto-start that download and MUST NOT require the user to choose `Baixar` for that offer. The transfers section SHALL keep history small by consolidating rows for the same identity hash when a peer-loss failure is resumed. The CLI process SHALL remain in the session until the user cancels or the peer sends `bye`. Unexpected transport failure after ready SHALL enter wait-to-reconnect rather than ending the interactive session by itself. Inbox chrome and action hints SHALL be in pt-BR per the hardcoded pt-BR user-facing UI requirement.

#### Scenario: Pending file appears in inbox
- **WHEN** the interactive CLI is connected and the remote peer announces a file with `meta` that is not eligible for auto-resume
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

#### Scenario: Auto-resume after peer reconnect
- **WHEN** interactive mode lost the peer mid-download with a retained `.drop`, the peer reconnects, and re-announces the same identity hash
- **THEN** the CLI starts the download without the user pressing `Baixar`
- **AND** the transfers section shows one in-progress row for that file (not a failed row plus a separate active row)

#### Scenario: Quick mode has no inbox
- **WHEN** the user runs with `-q`
- **THEN** the CLI does not present the interactive receive inbox
- **AND** incoming files are auto-downloaded per quick-mode receive behavior

#### Scenario: Peer leave returns to wait reconnect
- **WHEN** interactive mode had a ready session and the peer transport fails
- **THEN** the CLI shows waiting-to-reconnect status in pt-BR and keeps the process alive for re-pair
- **AND** does not exit solely due to that transport failure

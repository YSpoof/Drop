# Spec Delta

## ADDED Requirements

### Requirement: Host inbox keybindings after session ready
When the CLI hosts in interactive mode and the receive inbox is shown after a WebRTC session is ready, the CLI SHALL deliver inbox keyboard actions to the inbox UI without echoing those keystrokes as ordinary cooked terminal input. Bound keys (navigation, mark/select-all, download, remove/dismiss, copy PIN / share link when a host PIN is known, and quit) MUST perform their documented actions. This SHALL hold immediately after the first peer connect that ends host PIN wait, and again whenever the host inbox is active after a successful reconnect. The CLI MUST NOT leave the TTY in a state where typed characters appear as literal text under the inbox chrome instead of being handled as keybindings. Joiner inbox behavior is unchanged by this requirement.

#### Scenario: Host inbox keys work right after peer connect
- **WHEN** the CLI hosts in interactive mode, shows the PIN wait UI, a peer connects, and the receive inbox becomes active
- **THEN** pressing documented inbox keys (e.g. up/down or j/k, space, a, d, r, c/C when PIN known, q) performs those inbox actions
- **AND** those keystrokes do not accumulate as echoed plain text under the inbox chrome

#### Scenario: Host inbox keys still work after reconnect
- **WHEN** the host interactive inbox was active, the peer transport fails, the CLI waits to reconnect, and a new ready session returns to the inbox
- **THEN** inbox keybindings continue to perform their actions without cooked-text echo under the chrome

## MODIFIED Requirements

### Requirement: Interactive receive inbox
When the CLI runs in interactive mode (no `-q`) and a WebRTC session is ready, the CLI SHALL present a live inbox of remote files announced via `meta` that have not yet been downloaded or dismissed. Each pending entry SHALL offer actions to download (`Baixar`) that file and to remove/dismiss (`Remover`) that file. When hosting, those actions SHALL be operable via the inbox keybindings defined by the host inbox keybindings after session ready requirement (not only via non-keyboard means). The inbox SHALL update as new announcements arrive and as downloads complete or items are removed. The CLI process SHALL remain in the session until the user cancels or the peer sends `bye`. Unexpected transport failure after ready SHALL enter wait-to-reconnect rather than ending the interactive session by itself. Inbox chrome and action hints SHALL be in pt-BR per the hardcoded pt-BR user-facing UI requirement.

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

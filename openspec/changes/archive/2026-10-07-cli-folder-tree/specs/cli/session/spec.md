# Spec Delta

## MODIFIED Requirements

### Requirement: Host inbox keybindings after session ready
When the CLI hosts in interactive mode and the receive inbox is shown after a WebRTC session is ready, the CLI SHALL deliver inbox keyboard actions to the inbox UI without echoing those keystrokes as ordinary cooked terminal input. Bound keys (navigation including folder enter/up, mark/select-all, download via `d` only, remove/dismiss, copy PIN / share link when a host PIN is known, and quit) MUST perform their documented actions. Enter MUST NOT download. This SHALL hold immediately after the first peer connect that ends host PIN wait, and again whenever the host inbox is active after a successful reconnect. The CLI MUST NOT leave the TTY in a state where typed characters appear as literal text under the inbox chrome instead of being handled as keybindings. Joiner inbox behavior is unchanged by this requirement except that the same inbox keybindings apply when the joiner inbox is active.

#### Scenario: Host inbox keys work right after peer connect
- **WHEN** the CLI hosts in interactive mode, shows the PIN wait UI, a peer connects, and the receive inbox becomes active
- **THEN** pressing documented inbox keys (e.g. up/down or j/k, space, a, d, r, enter, esc, c/C when PIN known, q) performs those inbox actions
- **AND** those keystrokes do not accumulate as echoed plain text under the inbox chrome

#### Scenario: Host inbox keys still work after reconnect
- **WHEN** the host interactive inbox was active, the peer transport fails, the CLI waits to reconnect, and a new ready session returns to the inbox
- **THEN** inbox keybindings continue to perform their actions without cooked-text echo under the chrome

### Requirement: Interactive receive inbox
When the CLI runs in interactive mode (no `-q`) and a WebRTC session is ready, the CLI SHALL present a live inbox of remote files announced via `meta` that have not yet been downloaded or dismissed. The pending section SHALL present those offers as a path-segment folder tree derived from each offer’s `meta.name` (forward slashes): at the current directory level the inbox lists only immediate child folders and files, with a leading `..` row when the current level is not the tree root. Each pending file entry SHALL offer actions to download (`Baixar` / `d`) that file and to remove/dismiss (`Remover`) that file. Folder rows MAY be selected; selecting a folder selects all pending files under that folder recursively, and `d` / `r` on a folder (or with that folder selected) SHALL pull or dismiss those descendant files. Enter SHALL enter the highlighted folder or follow `..`, and MUST be a no-op on a file; Enter MUST NOT download. Esc SHALL move up one directory level and MUST be a no-op at the tree root (except when dismissing the Ctrl+C confirm overlay). When hosting, those actions SHALL be operable via the inbox keybindings defined by the host inbox keybindings after session ready requirement (not only via non-keyboard means). The inbox SHALL update as new announcements arrive and as downloads complete or items are removed. When an announced file matches a retained incomplete `.drop` per the auto-resume incomplete receive on matching hash requirement, the CLI SHALL auto-start that download and MUST NOT require the user to choose `Baixar` for that offer. The transfers section SHALL keep history small by consolidating rows for the same identity hash when a peer-loss failure is resumed. The CLI process SHALL remain in the session until the user cancels or the peer sends `bye`. Unexpected transport failure after ready SHALL enter wait-to-reconnect rather than ending the interactive session by itself. Inbox chrome and action hints SHALL be in pt-BR per the hardcoded pt-BR user-facing UI requirement.

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
- **WHEN** the inbox current directory is not the tree root and the user presses Esc (and the Ctrl+C confirm overlay is not showing)
- **THEN** the inbox navigates to the parent directory level

#### Scenario: Esc at root is a no-op
- **WHEN** the inbox is at the tree root and the user presses Esc (and the Ctrl+C confirm overlay is not showing)
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
- **WHEN** the user runs with `-q`
- **THEN** the CLI does not present the interactive receive inbox
- **AND** incoming files are auto-downloaded per quick-mode receive behavior

#### Scenario: Peer leave returns to wait reconnect
- **WHEN** interactive mode had a ready session and the peer transport fails
- **THEN** the CLI shows waiting-to-reconnect status in pt-BR and keeps the process alive for re-pair
- **AND** does not exit solely due to that transport failure

## ADDED Requirements

### Requirement: Inbox folder selection expands to descendant files
When the interactive inbox shows a folder row, Space SHALL toggle selection for that folder. A selected folder SHALL mark all currently pending files whose `meta.name` is under that folder’s path prefix. Download (`d`) and remove (`r`) SHALL expand any selected folders (and a cursor-only folder target when nothing is selected) into the set of descendant pending file IDs before calling pull or dismiss. The `..` row MUST NOT be selectable. Select-all (`a`) SHALL toggle selection for all selectable rows in the current directory view (files and folders), expanding folders to their descendant pending files.

#### Scenario: Space selects folder descendants
- **WHEN** pending offers include `photos/a.jpg` and `photos/nested/b.jpg` and the cursor is on the `photos` folder at root
- **AND** the user presses Space
- **THEN** both files under `photos` are treated as selected for a subsequent `d` or `r`

#### Scenario: Dotdot is not selectable
- **WHEN** the inbox shows a `..` row and the cursor is on it
- **AND** the user presses Space
- **THEN** selection state for pending files does not change solely because of that press

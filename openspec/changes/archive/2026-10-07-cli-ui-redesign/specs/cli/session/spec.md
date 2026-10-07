# Spec Delta

## ADDED Requirements

### Requirement: Responsive interactive dashboard layout
Interactive terminal surfaces (receive inbox, host PIN wait / reconnect chrome, Ctrl+C confirm overlay, mode/PIN/settings forms, donation reminder) SHALL lay out within the current terminal width and height. The CLI SHALL recalculate panel sizes on terminal resize. Content MUST NOT cause horizontal or vertical overflow of the visible terminal. Long names SHALL truncate with an ellipsis rather than wrapping when space is limited. Secondary metadata SHALL compress before primary status, peer identity, PIN, or action footer are sacrificed. Footer keybind hints SHALL wrap or collapse to remain usable on narrow terminals. All chrome labels and hints remain pt-BR.

#### Scenario: Resize keeps UI inside viewport
- **WHEN** the interactive inbox is showing and the terminal is resized smaller
- **THEN** the rendered view fits within the new width and height
- **AND** no panel permanently pushes the footer or header off-screen

#### Scenario: Long filename truncates
- **WHEN** a pending offer name exceeds the available row width
- **THEN** the displayed name is shortened with an ellipsis
- **AND** the row remains a single visual line for the name field

### Requirement: Scrollable pending-offer list
The pending-offers panel SHALL NOT grow unbounded with announcement count. When more rows exist than fit in the allocated panel height, the list SHALL scroll vertically, keep the cursor row visible while navigating with ↑/↓, and show a compact scroll position indicator (exact glyph flexible). The transfers panel and footer MUST remain within the terminal bounds regardless of pending-offer count. Visible row count SHALL be derived from available height.

#### Scenario: Many offers stay inside panel
- **WHEN** dozens of pending offers are announced and the terminal height is modest
- **THEN** only a height-fitting window of rows is shown
- **AND** ↑/↓ moves the cursor with the focused row kept visible
- **AND** a scroll-position hint is visible when not all rows fit

### Requirement: Incoming-file search with f
While the interactive inbox is active (and not on the Ctrl+C confirm overlay), pressing `f` SHALL enter search mode over pending offers (case-insensitive partial filename match against `meta.name` / visible row names). Matching SHALL filter or navigate to matching rows without overflowing the pending panel. ↑/↓ SHALL move among search results. Esc SHALL leave search mode and restore normal navigation. Enter in search mode SHALL confirm the current result and return to normal navigation without downloading. Footer hints SHALL advertise `f` for search while browsing; during search the footer SHALL show search-relevant hints instead of the full browse set. Search MUST NOT remap existing action keys (`d`, `c`, `C`, Space, `a`, `r`/`x`, `q`).

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

### Requirement: Compact transfer row presentation
Active and historical transfer rows in the interactive session SHALL present direction, filename, progress (bar and/or percent), transferred/total bytes when known, speed when active, and ETA when computable from speed and remaining bytes. Completion and failure states SHALL use distinct visual treatment. Multiple transfers SHALL stack within the transfers panel height budget without overflowing the terminal. This requirement does not add pause/resume keyboard controls.

#### Scenario: Active transfer shows progress details
- **WHEN** an inbound or outbound transfer is active with known size and positive speed
- **THEN** the transfers panel shows filename, progress, bytes, speed, and an ETA when remaining bytes and speed allow it

#### Scenario: Failed transfer is visually distinct
- **WHEN** a transfer fails or is cancelled
- **THEN** the row uses a failure visual treatment distinct from active and completed rows

### Requirement: Compact session header with optional LAN badge
Interactive session chrome SHALL show a compact header with connection state (visually obvious: connected / connecting / disconnected / waiting-reconnect as applicable), remote peer display name when known, and host PIN when known. When the signaling `lan` pairing flag is true, the header SHALL show a LAN indicator (same-network hint, matching Drop web). When `lan` is absent or false, the header MUST NOT show a WAN or WebRTC path label (transport is always WebRTC). Color SHALL emphasize state, not decoration. Copy actions remain `c` / `C` when a host PIN is known; hints stay in the footer (or header-adjacent hint line) without a separate help overlay.

#### Scenario: Connected header shows peer and PIN
- **WHEN** the host inbox is active with an assigned PIN and a connected remote peer
- **THEN** the header shows connected state, peer display name, and the PIN

#### Scenario: LAN pairing labeled
- **WHEN** the current pairing was accepted with signaling `lan: true`
- **THEN** the header shows a LAN indicator

#### Scenario: Non-LAN pairing has no path badge
- **WHEN** the current pairing was accepted without `lan: true`
- **THEN** the header does not show a LAN, WAN, or WebRTC path badge

### Requirement: Dedicated empty states
When there are no pending offers, the pending panel SHALL show a dedicated empty-state message in pt-BR (not a raw parenthetical aside). When there are no non-pending transfers to show, the transfers panel SHALL show a dedicated empty-state message in pt-BR. Compact forms MAY be used when height is tight.

#### Scenario: No pending offers
- **WHEN** the inbox is connected and no pending offers exist
- **THEN** the pending panel shows an empty-state waiting message in pt-BR

#### Scenario: No transfers yet
- **WHEN** no transfers are active or completed to display
- **THEN** the transfers panel shows an empty-state message in pt-BR

### Requirement: Cross-screen interactive visual consistency
Mode selection, PIN entry, settings, donation reminder, host PIN wait / reconnect status, confirm overlay, and the receive inbox SHALL share a consistent visual language (title/header emphasis, dim secondary text, semantic status colors, bordered or sectioned panels where the surface is a full-screen TUI). Huh-driven forms and notes SHALL adopt matching titles, emphasis, and pt-BR copy tone so they do not feel like a different product. No new help overlay (`?`) is required; discoverability remains via on-screen footer/hints.

#### Scenario: Form screens match chrome tone
- **WHEN** the user opens mode selection, settings, or the donation reminder in interactive mode
- **THEN** titles and secondary text follow the same emphasis hierarchy and pt-BR wording rules as the inbox chrome

## MODIFIED Requirements

### Requirement: Host inbox keybindings after session ready
When the CLI hosts in interactive mode and the receive inbox is shown after a WebRTC session is ready, the CLI SHALL deliver inbox keyboard actions to the inbox UI without echoing those keystrokes as ordinary cooked terminal input. Bound keys (↑/↓ navigation including folder Enter/Esc up, mark/select-all, download via `d` only, remove/dismiss via `r`/`x`, incoming-file search via `f`, copy PIN / share link when a host PIN is known via `c`/`C`, and quit via `q`) MUST perform their documented actions. Enter MUST NOT download (except that in search mode Enter confirms the search result and returns to browsing without downloading). The CLI SHALL NOT treat `j` or `k` as navigation aliases. This SHALL hold immediately after the first peer connect that ends host PIN wait, and again whenever the host inbox is active after a successful reconnect. The CLI MUST NOT leave the TTY in a state where typed characters appear as literal text under the inbox chrome instead of being handled as keybindings. Joiner inbox behavior is unchanged by this requirement except that the same inbox keybindings apply when the joiner inbox is active.

#### Scenario: Host inbox keys work right after peer connect
- **WHEN** the CLI hosts in interactive mode, shows the PIN wait UI, a peer connects, and the receive inbox becomes active
- **THEN** pressing documented inbox keys (↑/↓, Space, a, d, r, f, Enter, Esc, c/C when PIN known, q) performs those inbox actions
- **AND** those keystrokes do not accumulate as echoed plain text under the inbox chrome
- **AND** pressing `j` or `k` does not move the inbox cursor

#### Scenario: Host inbox keys still work after reconnect
- **WHEN** the host interactive inbox was active, the peer transport fails, the CLI waits to reconnect, and a new ready session returns to the inbox
- **THEN** inbox keybindings continue to perform their actions without cooked-text echo under the chrome

### Requirement: Interactive receive inbox
When the CLI runs in interactive mode (no `-q`) and a WebRTC session is ready, the CLI SHALL present a live inbox of remote files announced via `meta` that have not yet been downloaded or dismissed, using the responsive dashboard layout, scrollable pending list, compact transfer rows, compact header (including optional LAN badge), and dedicated empty states defined by this change. The pending section SHALL present those offers as a path-segment folder tree derived from each offer’s `meta.name` (forward slashes): at the current directory level the inbox lists only immediate child folders and files, with a leading `..` row when the current level is not the tree root. Cursor and selection SHALL remain visually distinct (cursor marker vs `[ ]`/`[x]`/`[-]` selection; folder rows use `[-]` when some but not all descendant files are selected). Each pending file entry SHALL offer actions to download (`Baixar` / `d`) that file and to remove/dismiss (`Remover`) that file. Folder rows MAY be selected; selecting a folder selects all pending files under that folder recursively, and `d` / `r` on a folder (or with that folder selected) SHALL pull or dismiss those descendant files. Enter SHALL enter the highlighted folder or follow `..`, and MUST be a no-op on a file; Enter MUST NOT download. Esc SHALL move up one directory level and MUST be a no-op at the tree root (except when dismissing the Ctrl+C confirm overlay or leaving search mode). When hosting, those actions SHALL be operable via the inbox keybindings defined by the host inbox keybindings after session ready requirement (not only via non-keyboard means). The inbox SHALL update as new announcements arrive and as downloads complete or items are removed. When an announced file matches a retained incomplete `.drop` per the auto-resume incomplete receive on matching hash requirement, the CLI SHALL auto-start that download and MUST NOT require the user to choose `Baixar` for that offer. The transfers section SHALL keep history small by consolidating rows for the same identity hash when a peer-loss failure is resumed. The CLI process SHALL remain in the session until the user cancels or the peer sends `bye`. Unexpected transport failure after ready SHALL enter wait-to-reconnect rather than ending the interactive session by itself. Inbox chrome and action hints SHALL be in pt-BR per the hardcoded pt-BR user-facing UI requirement. Help remains footer-only (no `?` overlay).

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
- **WHEN** the user runs with `-q`
- **THEN** the CLI does not present the interactive receive inbox
- **AND** incoming files are auto-downloaded per quick-mode receive behavior

#### Scenario: Peer leave returns to wait reconnect
- **WHEN** interactive mode had a ready session and the peer transport fails
- **THEN** the CLI shows waiting-to-reconnect status in pt-BR and keeps the process alive for re-pair
- **AND** does not exit solely due to that transport failure

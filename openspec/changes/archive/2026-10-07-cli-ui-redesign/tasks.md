# Tasks

## 1. Shared theme and pt-BR chrome strings

- [x] 1.1 Extract shared lipgloss tokens (title, accent, dim, ok/warn/err, panel border) used by inbox/confirm into a single place under `native/cli/internal/ui/tui` and verify existing confirm/inbox compiles and unit tests still pass (`go test ./internal/ui/tui/...`)
- [x] 1.2 Update `text` package with dashboard empty states, search hints, optional LAN badge label, and refreshed `InboxHelp` (include `f`, ↑/↓ only — no `j`/`k`, no `?`) and verify strings are pt-BR and referenced from UI code without unused leftovers for removed copy

## 2. Signaling LAN flag

- [x] 2.1 Add optional `lan` to `PeerJoiningMessage` / `JoinAcceptedMessage`, plumb through `SignalingPeerInfo` (or equivalent) and client dispatch, and verify signaling unit tests cover `lan: true` and missing `lan`
- [x] 2.2 Store via-LAN on `PeerState` (set on pair, clear on peer clear/disconnect) and verify state tests set/get/clear correctly

## 3. Inbox layout, scroll, header, transfers

- [x] 3.1 Implement height-budgeted View (header / pending / transfers / footer) from `width`/`height`, truncate long names, and verify a View snapshot or test with fixed small size shows no overflow past height
- [x] 3.2 Add scroll offset for pending rows with cursor kept visible + scroll indicator, and verify navigation tests with more rows than page height
- [x] 3.3 Render compact header (connection state, peer, PIN, optional LAN badge) from peer state and verify View shows LAN only when via-LAN is true
- [x] 3.4 Redesign `renderTransferItem` with progress bar, bytes, speed, ETA when computable; cap visible transfer blocks to panel budget; verify unit tests for active/completed/failed rendering
- [x] 3.5 Replace parenthetical empty copy with dedicated pending/transfers empty states and verify View contains the new pt-BR empty strings

## 4. Search and keybind cleanup

- [x] 4.1 Remove `j`/`k` navigation aliases from inbox `Update` and verify a test asserts `j`/`k` do not move the cursor while ↑/↓ still do
- [x] 4.2 Implement `f` search mode (query input, case-insensitive partial match per design, Esc exit, Enter confirm without download, ↑/↓ among results, footer hints) and verify focused search tests cover open/filter/esc/enter-no-download
- [x] 4.3 Ensure existing folder Enter/Esc, `d`, Space, `a`, `r`/`x`, `c`/`C`, `q` still pass (`go test ./internal/ui/tui/...`)

## 5. Cross-screen visual consistency

- [x] 5.1 Restyle Ctrl+C confirm overlay with shared tokens and verify confirm tests still pass and View uses shared styles
- [x] 5.2 Apply shared palette/title tone to huh mode/PIN/settings forms and donation reminder; verify forms still run and donation copy/close behavior tests (if any) pass
- [x] 5.3 Align host PIN wait / reconnect interactive status lines with compact header vocabulary (pt-BR connected/connecting/waiting + PIN/copy hints unchanged `c`/`C`) and verify quick/host paths still print or show expected status without breaking hostkeys tests (`go test ./internal/ui/quick/...`)

## 6. Integration check

- [x] 6.1 Run `go test ./...` from `native/cli` and fix regressions from this change
- [x] 6.2 Manual smoke (TTY): resize inbox with many offers, search with `f`, confirm LAN badge only after LAN pair (absent otherwise), and confirm footer-only hints with unchanged action keys

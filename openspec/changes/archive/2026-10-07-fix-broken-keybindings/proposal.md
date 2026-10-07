# Proposal

## Why

After a peer connects, the interactive receive inbox still draws and shows key hints (`espaço`, `a`, `d`, `r`, `c`/`C`, `q`), but keystrokes stop driving those actions and instead echo as cooked text under the TUI. The session becomes unusable for download/select/quit until the process is killed externally. This likely regressed when host PIN-wait took exclusive raw stdin for `c`/`C` copy keys without a hard handoff into the inbox bubbletea program.

## What Changes

- Guarantee a single stdin/TTY owner across the **host** PIN-wait → WebRTC-ready → inbox transition (and any Ctrl+C confirm overlay nested in that wait).
- Stop host copy-key watching and fully restore (or hand off) terminal state **before** the inbox bubbletea program starts reading stdin — no overlapping `term.MakeRaw` / `term.Restore` with `tea.NewProgram`.
- Same guarantee after host reconnect returns to the inbox (no second raw owner under live tea).
- Keep existing inbox keybindings and host copy shortcuts inside the inbox; no new keys, no UX redesign.
- **Out of scope:** joiner inbox (bug is host-only).

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `cli/session`: Host interactive receive inbox MUST keep consuming inbox keybindings after the session becomes ready — both right after first peer connect (PIN-wait ends) and after reconnect returns to the inbox. Stdin ownership MUST NOT leave the TTY in cooked-echo mode while the host inbox chrome is active.

## Impact

- `native/cli/internal/ui/quick/hostkeys.go` — lifecycle of raw stdin / stop synchronization
- `native/cli/internal/ui/quick/runner.go` — cancel/wait hostkeys before `runReceiveInbox`; reconnect paths if they re-touch stdin
- `native/cli/internal/ui/tui/inbox.go` / confirm overlay — only if handoff needs explicit tea options or init ordering
- Existing hostkeys / inbox / confirm tests; manual TTY smoke: host wait → peer connect → inbox keys, and host disconnect/reconnect → inbox keys
- No protocol, signaling, or config changes; joiner path untouched unless shared code requires a no-behavior host-only guard

# Proposal

## Why

Host wait UI prints PIN / copy hints / copy feedback with a staircase indent (each line starts further right). Classic raw-TTY missing `\r`: `hostCopyKeys` calls `term.MakeRaw` while status lines still use bare `\n`. Interrupt handling is also broken and inconsistent: during host PIN wait the first Ctrl+C only restores the TTY, and a second Ctrl+C prints `erro: context canceled`. Elsewhere, a single accidental Ctrl+C can kill the session with no chance to stay. Operators need readable wait output and a safe, consistent quit confirm everywhere.

## What Changes

- Keep host-wait status lines left-aligned on a TTY while `c`/`C` copy keys remain active (fix staircase rendering under raw / custom stdin handling).
- On first Ctrl+C (or equivalent interrupt) in any interactive/TTY session wait surface — host PIN wait, quick receive wait, wait-to-reconnect, and interactive inbox — show a full-viewport (alt-screen) confirm overlay in pt-BR: press Ctrl+C again to exit, or ESC to continue.
- Second Ctrl+C while the overlay is visible confirms exit; ESC dismisses the overlay and resumes the prior wait UI (including copy keys where applicable).
- Treat confirmed user cancel as a clean silent exit: do not print `erro: context canceled` on stderr or exit non-zero solely for that case.
- Preserve existing copy behavior (`c` / `C` + pt-BR feedback) and non-TTY no-op for copy-key watching.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `cli/session`: Add requirements for left-aligned host-wait terminal output, Ctrl+C confirm-to-exit overlay (everywhere on TTY session waits), and clean silent exit on confirmed cancel.

## Impact

- Primary: `native/cli/internal/ui/quick/hostkeys.go`, host/receive/reconnect wait paths in `runner.go`, interactive inbox (`internal/ui/tui`), shared confirm-overlay UI, and cancel handling in `cmd/dropcli/main.go`.
- Possibly shared line helpers / string constants in `internal/ui/text` (CRLF discipline + overlay copy).
- Existing tests around `hostCopyKeys` / runner / inbox cancel paths; manual TTY smoke for staircase, overlay, ESC, and double Ctrl+C.
- No protocol, signaling, or clipboard URL shape changes.

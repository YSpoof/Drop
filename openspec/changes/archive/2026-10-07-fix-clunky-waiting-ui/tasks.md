# Tasks

## 1. CRLF-safe host-wait output

- [x] 1.1 Add a small helper (or temporary stdout/stderr wrapper) that writes lines with `\r\n` while host copy-key raw mode is active; verify with a focused unit test that bare `\n` in `text.*` strings becomes `\r\n` on the writer and that the helper is unused / no-op when raw is inactive
- [x] 1.2 Route host-wait prints through that path: `OnCodeAssigned` PIN + copy hint, and `hostCopyKeys` copy success/failure lines; verify by code audit that no other host-wait `fmt` print during raw uses bare `\n` alone, and by manual TTY smoke (`drop -q -s`) that PIN, hint, and `c`/`C` feedback stay left-aligned

## 2. Shared confirm-to-exit overlay

- [x] 2.1 Add pt-BR overlay strings in `internal/ui/text` (Ctrl+C again to exit / ESC to continue) and a shared full-viewport alt-screen confirm component (bubbletea model or equivalent) with outcomes: confirm-exit vs dismiss; verify unit/model tests cover first Ctrl+C stays open, second Ctrl+C → confirm, ESC → dismiss, and View contains the pt-BR copy
- [x] 2.2 Wire host PIN wait: on first raw `0x03`, pause `hostCopyKeys`, show overlay without canceling the session; on ESC restore raw + resume keys; on confirm call session cancel; verify injectable/fake-stdin test (or harness) for the three outcomes and that peer-start still only stops keys via `hostKeysCancel`
- [x] 2.3 Wire quick receive wait and wait-to-reconnect so first Ctrl+C shows the same overlay (session context cancels only on confirm); verify by extending existing cancel/wait tests where practical and manual TTY smoke for both surfaces
- [x] 2.4 Wire interactive inbox so first `ctrl+c` shows the same overlay (modal/child) instead of quitting; ESC clears overlay and keeps inbox; confirm quits session; verify with inbox model tests and/or manual interactive smoke

## 3. Clean silent exit on confirmed cancel

- [x] 3.1 In `cmd/dropcli/main.go`, if `run` returns `errors.Is(err, context.Canceled)`, exit 0 with no `erro:` print; keep `erro:` + exit 1 for other failures; verify with a small unit test of the exit decision covering cancel vs non-cancel, and manual confirmed double-Ctrl+C smoke showing no `erro: context canceled` and exit status 0

# Tasks

## 1. Hostkeys stop barrier

- [x] 1.1 Add a done signal (WaitGroup or closed channel) so `hostCopyKeys` / `hostCopyKeysFrom` reports when the goroutine has finished restore and returned; verify with a unit test that canceling the watch context causes the done signal after exit (non-TTY path may complete immediately)
- [x] 1.2 Ensure confirm-overlay pause/re-enter-raw path still restores exactly once on final exit (no double-restore after tea); verify existing host interrupt confirm tests still pass and add/adjust a focused check that done fires only after final restore

## 2. Runner handoff before inbox

- [x] 2.1 In `runner.go`, after peer pairing cancels hostkeys (and before `runReceiveInbox`), wait on the hostkeys done barrier; verify by code audit / test hook that `tea.NewProgram` for the inbox cannot start while `hostRawIsActive()` is still true
- [x] 2.2 Confirm inbox `waitForReconnect` does not start a new `hostCopyKeys` raw owner under the live tea program; verify by code audit that reconnect only sends tea refresh messages and leaves stdin to bubbletea

## 3. Host smoke / regression

- [x] 3.1 Manual TTY smoke as host (no `-q`): PIN wait → peer connect → inbox; press space/a/d/r/c/C/q and confirm actions work with no echoed garbage under the chrome
- [x] 3.2 Manual TTY smoke as host after reconnect: from an active host inbox, drop the peer (or otherwise trigger wait-to-reconnect), reconnect to ready inbox again; confirm the same keys still work with no cooked echo (and that no second `hostCopyKeys` raw owner started under tea)

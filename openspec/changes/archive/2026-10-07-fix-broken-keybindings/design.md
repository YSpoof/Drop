# Design

## Context

See proposal.md — Why.

Host interactive PIN wait uses `Runner.hostCopyKeys` (`native/cli/internal/ui/quick/hostkeys.go`): `term.MakeRaw` on stdin, byte-read loop for `c`/`C`/Ctrl+C, `term.Restore` on exit. On peer pairing, `runner.go` cancels `hostKeysCtx` then `waitReady` then `runReceiveInbox`, which starts bubbletea on the same `os.Stdin`.

Cancel alone does not serialize ownership: the copy-key goroutine may still be inside `Read` (up to the 200ms deadline) and its deferred/`once` restore can run **after** tea has entered its own raw/alt-screen state. Restoring the pre-wait cooked attrs over tea leaves echo on; the inbox View still paints, but keys appear as literal text under the chrome — matching the reported bug.

Prior change `fix-clunky-waiting-ui` already named this risk (“never run two raw owners at once”) but only serialized hostkeys ↔ confirm overlay, not hostkeys ↔ inbox.

Confirmed scope: bug is **host-only**; must work on **first connect and after reconnect**. Joiner path skips `hostCopyKeys` and is out of scope.

## Goals / Non-Goals

**Goals:**

- Exactly one stdin/TTY owner at a time across host PIN wait, confirm overlay, and host inbox.
- Hostkeys fully stopped + TTY restored (or never overlapping restore) before `tea.NewProgram(...).Run()` for the inbox.
- Host inbox keybindings remain live after first ready **and** after reconnect returns to the inbox.

**Non-Goals:**

- Joiner inbox keybinding investigation or changes.
- Redesigning inbox bindings or chrome copy.
- Replacing bubbletea or host copy-key UX during PIN wait.
- Changing signaling / WebRTC / transfer protocol.

## Decisions

### 1. Hard stop barrier before inbox

**Choice:** When leaving host PIN wait for the ready→inbox path, cancel hostkeys **and wait** until the copy-key goroutine has finished (WaitGroup or done channel), so `term.Restore` cannot race with tea. Call that barrier before `runReceiveInbox` (and before any other consumer that takes stdin after wait).

**Why:** Context cancel is async relative to `Read` + restore. A sync barrier is the smallest fix that matches the existing “one owner” rule.

**Alternatives:**

- Drop `Restore` and let tea own forever — leaks cooked state if inbox never starts; bad for non-inbox exits.
- Move copy keys into a long-lived tea program for PIN wait — larger rewrite, out of scope.
- Poll `hostRawIsActive()` before starting tea — racy and easy to miss other exit paths.

### 2. Keep MakeRaw only inside hostCopyKeys; tea owns inbox

**Choice:** Do not start a second raw reader alongside tea. Inbox keeps handling `c`/`C` in `InboxModel.Update`. Confirm overlay during PIN wait keeps pause/restore/re-enter raw as today, still under hostkeys ownership.

**Why:** Inbox already implements copy shortcuts; bug is handoff, not missing bindings.

### 3. Reconnect while host inbox runs

**Choice:** Do **not** restart `hostCopyKeys` during inbox-owned `waitForReconnect`. Inbox tea stays the stdin owner for the whole reconnect wait; status updates go through tea messages (`InboxRefresh`) as today. First-connect barrier fix also prevents a permanently cooked TTY from surviving into reconnect.

**Why:** Restarting raw hostkeys under a live tea program would reintroduce dual ownership (and matches the reported reconnect failure mode). Copy PIN/link already work inside inbox when PIN is known.

### 4. Tests / proof

**Choice:** Prefer a unit/integration-style test that proves stop-before-inbox ordering (e.g. injectable stdin/FD or a hook/done signal that `runReceiveInbox` waits on). Manual host TTY smoke for first connect **and** reconnect remains required for echo behavior. Do not invent broad e2e WebRTC tests unless a cheap harness already exists.

**Why:** Full peer-connect e2e is heavy; the race is local to stdin lifecycle.

## Risks / Trade-offs

- **[Risk]** Barrier waits forever if hostkeys hangs in `Read` without deadline — **Mitigation:** keep read deadline; barrier is just “goroutine exited”; session cancel still ends the loop via ctx.
- **[Risk]** Reconnect path silently restarts hostkeys later — **Mitigation:** audit `waitForReconnect` / inbox disconnect goroutine; task requires no new raw owner under tea.
- **[Risk]** Confirm overlay during PIN wait still races with peer-start cancel — **Mitigation:** overlay already restores/re-enters raw; barrier after wait still runs before inbox; ensure cancel during overlay exits hostkeys cleanly (no second restore after tea).
- **[Trade-off]** Sync wait adds a few hundred ms worst-case at connect — acceptable vs broken inbox.

## Migration Plan

- Ship as normal CLI binary update; no config/protocol migration.
- Rollback: revert hostkeys stop barrier / runner wait wiring.

## Open Questions

- None. Scope locked: host-only; first connect + reconnect.

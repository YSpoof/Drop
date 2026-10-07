# Design

## Context

See proposal.md — Why. Observed root causes (read-only inspection):

- `Runner.hostCopyKeys` (`native/cli/internal/ui/quick/hostkeys.go`) calls `term.MakeRaw` on stdin for the whole host PIN-wait window so single-key `c`/`C` work without Enter.
- `MakeRaw` disables output post-processing (`ONLCR`): bare `\n` advances the row but not the column → staircase.
- Concurrent prints (`OnCodeAssigned` PIN/hint on stdout; copy feedback on stderr) still use string constants ending in `\n` only (`internal/ui/text`).
- Raw mode also disables `ISIG`: Ctrl+C arrives as byte `0x03`. Current handler restores the TTY and returns **without** canceling — and without any confirm UI. Elsewhere (cooked wait / bubbletea inbox), Ctrl+C can tear down immediately or surface `erro: context canceled` via `main`.

Confirm-to-exit must cover every TTY session wait surface, not only host PIN wait.

## Goals / Non-Goals

**Goals:**

- Left-aligned host-wait lines on TTY while `c`/`C` keep working.
- Shared full-viewport (alt-screen) confirm overlay in pt-BR on first Ctrl+C everywhere: host PIN wait, quick receive wait, wait-to-reconnect, interactive inbox.
- Second Ctrl+C confirms exit; ESC dismisses overlay and resumes prior UI.
- Confirmed cancel exits 0 silently (no `erro: context canceled`).
- Keep non-TTY no-op for copy-key watching; overlay is TTY-only.

**Non-Goals:**

- Rewriting the entire host wait as a persistent bubbletea app (beyond overlay / shared interrupt handling).
- Changing clipboard / share URL shape or copy feedback wording (aside from newline discipline + new overlay strings).
- Overlay on non-TTY / pure piped runs.

## Decisions

### 1. Keep `MakeRaw` for host copy keys; emit CRLF while raw is active

**Choice:** While stdin is raw for `hostCopyKeys`, write host-wait status lines with `\r\n`, via a small helper or temporary stdout/stderr wrapper used by copy feedback **and** signaling handler prints that race with raw (PIN + hint). Do not change all global `text.*` constants to `\r\n`.

**Why:** Surgical fix for staircase. No new deps.

**Alternatives considered:** Custom termios keeping `ONLCR`/`ISIG`; restore-print-MakeRaw races; full bubbletea wait UI — deferred except where overlay needs a program.

### 2. Shared confirm-overlay interrupt UX (everywhere)

**Choice:** Introduce a shared confirm-to-exit component (preferred: small bubbletea model or equivalent alt-screen renderer) that:

1. On first interrupt → enter alt-screen / full viewport, show pt-BR copy: press Ctrl+C again to exit, ESC to continue.
2. On second Ctrl+C → leave overlay, cancel session context (confirmed exit).
3. On ESC → leave overlay, restore prior wait surface and continue (re-arm host copy keys if that surface is active).

Wire the same behavior into:

| Surface | Interrupt source today | Integration |
|---------|------------------------|-------------|
| Host PIN wait | raw byte `0x03` in `hostCopyKeys` | First `0x03` → pause copy loop, run overlay; on ESC resume raw + keys; on confirm → session cancel |
| Quick receive wait | `signal.NotifyContext` / `ctx.Done()` | Intercept first SIGINT before fatal cancel, or run overlay from a dedicated cancelable wait wrapper |
| Wait-to-reconnect | same | same wrapper |
| Interactive inbox | bubbletea `ctrl+c` → quit | First `ctrl+c` shows overlay as child/modal; confirm → quit; ESC → clear modal |

**SIGINT / raw conflict:** Host PIN wait must handle confirm inside the raw reader (byte `0x03`) so a “real” SIGINT is not required for the first press. For cooked waits, replace immediate process death with: stop → overlay → confirm cancel or ESC resume. Prefer one session-level `WithCancel` that only fires on **confirmed** exit, so `main` never sees cancel from a dismissed first Ctrl+C.

**Copy (pt-BR):** Centralize strings in `internal/ui/text`, e.g. title/body along the lines of “Pressione Ctrl+C novamente para sair” and “Pressione ESC para continuar” (exact wording polish OK at implement time; must be pt-BR).

**Why:** Spec requires identical overlay semantics on every TTY wait surface; shared component avoids four divergent implementations.

**Alternatives considered:**

- Immediate cancel on first Ctrl+C (earlier plan) — rejected by product.
- Line-mode “press again” without full viewport — rejected; user asked for alt-screen overlay.
- Per-surface ad-hoc prompts — higher drift risk.

### 3. `main` treats intentional cancel as success

**Choice:** In `cmd/dropcli/main.go`, if `run` returns `errors.Is(err, context.Canceled)`, exit 0 with no `erro:` line. Other errors keep `erro:` + exit 1.

**Why:** Confirmed cancel should be silent success. First Ctrl+C must not cancel the run context at all (only overlay), so accidental first press never reaches `main` as an error.

### 4. Scope of CRLF writers

**Choice:** Every line printed while `hostCopyKeys` holds raw mode uses the CRLF path (PIN, hint, copy feedback). Overlay owns its own alt-screen rendering and restores the prior screen on dismiss.

## Risks / Trade-offs

- **[Risk]** Missed print site under raw → partial staircase. → **Mitigation:** Audit host-wait prints; one write helper while raw flag set.
- **[Risk]** Double ownership of stdin (raw hostkeys vs overlay vs inbox tea). → **Mitigation:** Serialize: stop hostkeys / pause tea input before overlay; restore after ESC; never run two raw owners at once.
- **[Risk]** First SIGINT cancels `NotifyContext` before overlay can show (cooked waits). → **Mitigation:** Do not rely on `NotifyContext` alone for first Ctrl+C on those surfaces — use a custom signal/notify layer or bubbletea/`tea.WithContext` pattern that only cancels on confirm; keep `NotifyContext` as outer kill for force-quit if needed (e.g. third interrupt) only if product wants it later — **out of scope** unless implementer finds no other way; default is two-step only.
- **[Risk]** Filtering all `context.Canceled` at `main` hides non-user cancel. → **Mitigation:** Only confirmed paths cancel the run context; internal soft-cancels use distinct errors if needed later.
- **[Trade-off]** Shared overlay adds a bit more UI code than a one-line “press again” print, but matches the requested full-viewport UX.

## Migration Plan

- Ship as normal CLI binary update; no config or protocol migration.
- Rollback: revert CRLF helper, confirm overlay, wait-surface wiring, and `main` cancel exit.

## Open Questions

- None blocking. Exact pt-BR microcopy can be polished at implement time within the meaning above.

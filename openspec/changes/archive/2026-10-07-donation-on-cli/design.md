# Design

## Context

See proposal.md for why. Behavior contract is `specs/cli/donation-reminder/spec.md` plus the `cli/session` Configurações delta.

Web/desktop already implements the same interval model in `src/lib/utils/donationReminder.ts` (`visitCount` + `donationReminderAnchor`, interval `25`) and `DonationReminderModal.svelte`. CLI persists prefs in `~/.dropConfig` via `state.Store` / `state.Config` (`deviceName`, `downloadDir`, `transferStats` today). Interactive entry is `tui.RunForm` (mode select) and `tui.RunConfigMenu`; quick mode never shows those menus. Clipboard helper already exists for PIN/link copy.

## Goals / Non-Goals

**Goals:**

- Mirror web interval semantics with a CLI-owned counter in `~/.dropConfig`.
- Show the reminder only when the interactive mode menu would run.
- Reuse existing clipboard + huh/bubbletea UI patterns; pt-BR strings in `text`.
- Expose PIX in `Configurações` always.

**Non-Goals:**

- Sharing visit state with web/desktop localForage.
- Showing the reminder in `-q`, mid-session, or after session exit.
- Permanent opt-out, extra payment methods, or changing the PIX key value.
- Wiring Configurações into the mode menu if it is not already offered (existing session wording already says “when offered”); this change only adds PIX to `RunConfigMenu`.

## Decisions

### 1. Persist `visitCount` + `donationReminderAnchor` in `~/.dropConfig`

Add JSON fields on `state.Config` (names aligned with web keys for mental mapping): `visitCount` (int), `donationReminderAnchor` (int, default 0). Due when `visitCount >= donationReminderAnchor + 25`. Dismiss sets anchor to current `visitCount`.

Alternative considered: separate file — rejected; one config file already owns CLI device prefs and stats.

### 2. Increment on every process start in `main` / `run`

Call a small helper once after settings load (both quick and interactive paths) so `-q` counts. Helper loads, increments, saves, returns whether due. Do not increment again within the same process.

### 3. Show only when about to present the mode menu

Gate the prompt in the interactive path that calls `RunForm` (no `-s`/`-c`). If due, run donation TUI first; on **Fechar**, persist dismiss then continue to mode select. If the user aborts without dismiss, leave due. Paths that skip `RunForm` never call the prompt.

Alternative considered: after session end — rejected per product choice (1.a).

### 4. Donation UI as a focused huh/tea prompt, not inbox overlay

Standalone confirm-style flow: title, body, PIX copy action, **Fechar**. Reuse `ui.CopyToClipboard`. Keep it out of session wait surfaces so it cannot fight confirm-to-exit / host copy keys.

### 5. Hardcode PIX key constant matching `siteData.donationPixKey`

CLI has no access to `siteData.ts`. Put the same UUID string in a CLI constant (e.g. next to other shared branding/text). Document that web and CLI must stay in sync when the key changes.

Alternative considered: build-time inject from shared JSON — overkill for one string.

### 6. Configurações PIX block in `RunConfigMenu`

Add a copy-PIX action (note or confirm/select that triggers copy + feedback) without tying it to dismiss logic. Opening settings alone does not clear a due reminder.

### 7. Interval constant `25`

Same numeric policy as web `DONATION_REMINDER_INTERVAL`. Duplicate the constant in CLI rather than sharing a package across Go/TS.

## Risks / Trade-offs

- [Corrupt or partial `~/.dropConfig`] → Existing store already ignores corrupt JSON and returns empty config; treat missing visit fields as 0 so due math still works after first good save.
- [SaveConfig overwriting visit fields] → Any `Save`/`FlushStats` path that rebuilds `Config` MUST preserve `visitCount` and `donationReminderAnchor` the same way `TransferStats` is preserved today.
- [PIX key drift vs web] → Single constant + note in tasks; no runtime sync.
- [Mode menu without Configurações option today] → Spec already allows “when offered”; reminder still shows before Host/Join select. PIX in `RunConfigMenu` covers settings whenever that entry is reachable (tests / future menu wiring).

## Migration Plan

- New JSON fields are additive; old configs load with zeros → first 25 runs after upgrade before first prompt (or sooner if visit was somehow pre-seeded — default is fresh count from upgrade).
- No rollback beyond omitting the new UI; leftover fields in JSON are harmless.

## Open Questions

None — product choices locked (mode menu only, count `-q` but never show there, PIX in Configurações).

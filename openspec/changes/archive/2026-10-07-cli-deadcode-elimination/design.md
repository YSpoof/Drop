# Design

## Context

See proposal.md for motivation. Scope is `native/cli` only.

Observed today (Linux host, `deadcode` without/with `-test`):

| Symbol / area | Status |
| --- | --- |
| `quick.WithWatcherPort`, `WithSessionConfig`, `WithOutput` | Unreachable even from tests |
| `FolderWatcherService.Dir` | Unreachable |
| `FolderWatcherService.DequeueAll`, `QueueLen` | Production-unreachable; used only by `watcher_test` |
| `state.NewTestStore` | Production-unreachable; used by tests |
| `libs/ptypair` | Production-unreachable; used only by `hostkeys_test` |
| `tui.NewConfirmModel` | Production-unreachable; one test uses it (`NewConfirmOverlay` is the live API) |
| `tui.RunConfigMenu`, `CopyDonationPIX` | Production-unreachable from `main` / mode menu, but implement Configurações + PIX per `cli/session` and `cli/donation-reminder` (“when offered”) |
| `libs/clip/write_other.go` | Darwin/other stub (`!linux && !windows`) |
| `breakread` / `ptypair` `*_other.go` | `!linux` (covers Windows + Darwin today) |

Large files (>~450 lines): `ui/quick/runner.go` (~1129), `ui/tui/inbox.go` (~1073), `services/transfer.go` (~825), `services/transfer_test.go` (~851), `services/download.go` (~531).

## Goals / Non-Goals

**Goals:**

- Delete true dead code and test-only helpers; adjust tests accordingly.
- Make non-linux/windows builds fail without unsupported stubs.
- Split oversized `.go` files into same-package modules under ~450 lines each, preserving exported APIs and UI/behavior.
- Re-run `deadcode` / tests until Linux + Windows targets are clean of newly introduced unused exports.

**Non-Goals:**

- Wiring `Configurações` into the mode menu (keep `RunConfigMenu`; do not change UI).
- Changing transfer protocol, TUI chrome, pt-BR copy, or flag surface.
- Touching packages outside `native/cli`.
- Enforcing a hard line-count linter in CI (soft target for this cleanup only).

## Decisions

### 1. Keep Configurações helpers despite deadcode

**Choice:** Do not delete `RunConfigMenu` / `CopyDonationPIX`.

**Why:** Specs already require that surface when offered; prior donation work intentionally left menu wiring optional. Deleting would remove the only implementation and create a silent spec gap while changing nothing visible today.

**Alternative:** Delete as unused → rejected (conflicts with `cli/session` / `cli/donation-reminder`).

### 2. Platform strategy: compile-fail, not stub

**Choice:**

- Delete `libs/clip/write_other.go`.
- Retag `breakread` fallback from `!linux` to `windows` (Windows still needs the deadline-based reader; Linux keeps `reader_linux.go`).
- Delete entire `libs/ptypair` (see decision 3).
- Add `//go:build linux || windows` on package roots that would otherwise compile empty on other GOOS (at minimum `cmd/dropcli` and DIY libs), so `GOOS=darwin go build` fails clearly.

**Why:** User asked to remove all non-target platforms; existing clipboard already documents Linux/Windows only.

**Alternative:** Keep stubs that return errors → rejected (user: remove all).

### 3. Remove `ptypair`

**Choice:** Delete `libs/ptypair` and rewrite `hostkeys_test` to drive `breakread` / host-key handling without a real PTY (pipes, fake readers, or narrower unit tests of the cancel path).

**Why:** Only test consumers; production host PIN wait uses stdin + `breakread`, not `ptypair`. Spec delta drops `ptypair` from required DIY packages.

**Alternative:** Keep package for future tests → rejected (user: remove test-only helpers).

### 4. Deadcode removal bar

**Choice:** Remove binary-unreachable symbols **and** helpers only referenced by tests. Move true test fixtures (e.g. `NewTestStore`) into `*_test.go` in the same package or inline construction in tests. Delete unused runner options. Drop `DequeueAll` / `QueueLen` / `Dir` if unused by production; rewrite watcher tests to assert via remaining public behavior (events / drain API that production uses).

**Why:** Matches clarified scope (“both”).

**Guard:** After edits, `deadcode -test=false ./...` and package tests must pass on linux; windows build via `GOOS=windows go test` (or cross-compile) for tagged files.

### 5. File split plan (same package, no behavior change)

Stay in existing packages; extract by concern. Target each new file well under 450 lines. Suggested cuts (adjust names if clearer while applying):

| Current | Split into |
| --- | --- |
| `ui/quick/runner.go` | `config.go` (flags/parse/validate), `runner.go` (struct/options/ctors/accessors), `runner_session.go` (connect/reconnect/session gate), `runner_inbox.go` (inbox UI program wiring), `runner_transfer.go` (send/watch/callback wiring) |
| `ui/tui/inbox.go` | `inbox.go` (model/Init/Update/msgs), `inbox_search.go`, `inbox_selection.go`, `inbox_tree.go` (rows/folders/paths), `inbox_view.go` (View + layout helpers not already in `view.go`) |
| `services/transfer.go` | `transfer.go` (type/ctors/config/queue), `transfer_control.go` (HandleControl/pull/dismiss), `transfer_send.go` (SendFile*/chunk/credit loop) |
| `services/download.go` | `download.go` (pending/manual/meta/pull/dismiss), `download_stream.go` (start/chunk/done/cancel) |
| `services/transfer_test.go` | One file per major scenario group or shared `transfer_test_helpers.go` + multiple `transfer_*_test.go` under 450 lines |

**Rules:** No new packages unless import cycles force it; keep exported names stable; move only code; update tests’ package-local access only if needed.

**Alternative:** New subpackages (`tui/inbox`, `services/transferx`) → rejected for this pass (more churn, behavior-risk for little gain).

### 6. Confirm API cleanup

**Choice:** Prefer `NewConfirmOverlay` / zero-value patterns; delete `NewConfirmModel` if tests can construct via overlay or struct literal without behavior change.

### 7. Verification order

1. Platform tags + delete stubs/`ptypair`.
2. Deadcode deletions + test rewrites.
3. File splits (mechanical moves).
4. `go test ./...` on linux; `GOOS=windows go test ./libs/...` (and any windows-tagged packages); `deadcode` sweep.

## Risks / Trade-offs

- [Hostkeys tests harder without PTY] → Use pipes/`breakread` on a regular file or extract cancelable-read seams; drop PTY integration coverage if it cannot be simulated cleanly.
- [Split causes merge conflicts / missed unexported moves] → Split after deadcode deletes; keep package-local; run full test suite after each large file.
- [Accidental UI change while splitting inbox/runner] → No logic edits in split commits/tasks; only move + fix compile.
- [Leaving `RunConfigMenu` looks “still dead”] → Documented keep; optional follow-up change to offer Configurações in mode menu (out of scope).

## Migration Plan

- In-tree refactor only; no data migration.
- Consumers: Drop CLI binary users on Linux/Windows — no action.
- Darwin users: **BREAKING** — must use Linux/Windows builds; no stub fallback.

## Open Questions

None — platform, scope, split threshold, deadcode bar, and Configurações keep decision are locked.

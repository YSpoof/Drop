# Tasks

## 1. pt-BR peer-loss copy

- [x] 1.1 Add `text` constant for peer-loss reason (`conexão perdida`) and use it for all `FileTransfer.Error` / `InterruptReceives` / `SetStatus` paths that surface in the TUI; verify inbox failed row shows `(conexão perdida)` and no English `peer lost` in that chrome (spot-check `text` + transfer/download call sites; `go test ./internal/services/ ./internal/state/`)

## 2. Transfer-list identity consolidation

- [x] 2.1 Add identity `Hash` on `state.FileTransfer` and set it from inbound/outbound `meta.hash` when adding receive (and send if trivial); verify existing transfer tests still compile/pass
- [x] 2.2 On `AddTransfer` for a receive with non-empty hash, remove prior receive row(s) for that hash (failed/interrupted leftover) and place the new row at the replaced position when practical; verify with unit coverage in existing `state` tests that peer-loss then new `fileId` leaves a single `GetAll()` entry for that hash

## 3. Manual-mode auto-pull on retained `.drop`

- [x] 3.1 After manual `HandleMeta` registers a pending offer, if `dropResumeOffset(meta) > 0`, trigger the same pull path as inbox download (`PreparePull` + `pull-batch`) without user input; verify with service-level test or controlled scenario that matching partial auto-sends pull and fresh announce without partial does not
- [x] 3.2 Ensure dismiss/remove still deletes `{hash}.drop` and a later re-announce of that hash stays pending (no auto-pull); verify with existing dismiss behavior + auto-pull eligibility check
- [x] 3.3 Wire any callback/hook so interactive session (transfer service ready) performs auto-pull on post-reconnect `meta`; verify no dependency on inbox keypress and quick mode behavior unchanged

## 4. Integration check

- [x] 4.1 Manual path: interrupt mid-download → failed row `conexão perdida` → same peer re-announces same hash → auto resume, single yellow/active transfers row, progress continues from partial; confirm dismiss then re-announce still requires `d`

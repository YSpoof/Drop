# Tasks

## 1. Inbox tree model

- [x] 1.1 Add cwd + row builders (folders/files/`..` from pending `meta.name` prefixes) in inbox TUI and verify unit coverage for nested vs basename-only offers
- [x] 1.2 Wire View to render current-level rows (folder marker, file size, selection checkbox; skip checkbox on `..`) and verify View output includes `..` when cwd is non-root

## 2. Keybindings and actions

- [x] 2.1 Remap Enter to enter folder / follow `..` (no-op on file; never pull) and Esc to go up (no-op at root when not confirming); verify Update tests for enter/esc/`d` separation
- [x] 2.2 Expand Space / `a` / `d` / `r` through folder descendants to fileIds; ignore Space on `..`; verify batch pull/dismiss id sets for folder targets
- [x] 2.3 Update pt-BR `InboxHelp` (and any related status copy) for Enter/Esc/`d` and verify help string no longer implies Enter downloads

## 3. Finalize path confirmation

- [x] 3.1 Confirm `FinalizeDrop` nested-path + `..` rejection matches file-transfer delta; add/adjust a focused FS test for `photos/nested/a.jpg` under download dir if missing, and verify it passes

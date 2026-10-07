# Proposal

## Why

`native/cli` has accumulated unreachable helpers, platform stubs outside the Linux/Windows targets, and several 450–1100 line source files. That slows review and change, and invites accidental use of dead APIs. Clean the tree without changing Linux/Windows behavior or UI.

## What Changes

- Remove unused production symbols and test-only helpers (including rewriting or deleting tests that exist only to exercise them).
- **BREAKING**: Drop all non-Linux/Windows platform support from the CLI module — delete Darwin/`other` stubs; `GOOS` outside `linux`/`windows` MUST fail to compile (no “unsupported platform” stub packages).
- Remove DIY `ptypair` (only referenced by hostkeys tests); rewrite those tests without a PTY dependency.
- Split every `.go` file over ~450 lines into smaller modules in the same package (or clear sub-concern files), including tests. Known offenders: `ui/quick/runner.go`, `ui/tui/inbox.go`, `services/transfer.go`, `services/transfer_test.go`, `services/download.go`.
- Keep `RunConfigMenu` / `CopyDonationPIX` — unreachable from the current mode menu, but they are the Configurações + PIX surface required by existing specs (“when offered”). Do not delete; wiring the mode-menu entry is out of scope.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `cli/libs`: Require Linux/Windows-only builds for DIY libs (no other-GOOS stubs); drop `ptypair` from the required DIY package set; keep `clip` and `breakread`.

## Impact

- Code: `native/cli` only — services, state, UI (`quick`/`tui`), and `libs/`.
- Behavior/UI on Linux and Windows: unchanged by intent (refactor + deletion of unused paths only).
- Tests: remove or rewrite tests that only covered deleted helpers; hostkeys tests no longer need `ptypair`.
- Compatibility: Darwin and any other non-target `GOOS` no longer build.

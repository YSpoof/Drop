# Proposal

## Why

Drop web and desktop already speak pt-BR to users. Drop CLI still shows English prompts, status, help, and inbox copy, so the same product feels inconsistent. Align CLI user-facing text with web/desktop now that the CLI is part of the distributed clients.

## What Changes

- **BREAKING** (user-visible): Replace hardcoded English CLI UI strings with hardcoded pt-BR. No locale switcher; English UI is removed.
- Interactive mode role choices MUST use the exact web/desktop labels: `Gerar um código` (host) and `Possuo um código` (join).
- Shared product terms MUST match web/desktop where the concept exists (e.g. `Nome de exibição`, `Baixar`, `Remover`, `Copiar código`, `Configurações`, `PIN`/`código` as used on web).
- Translate all other user-facing surfaces: huh forms, inbox/TUI chrome, connection status, copy feedback, flag help/`Usage`, quick-mode stdout/stderr lines, and validation errors shown to the user.
- Keep code, identifiers, flag names (`-h`, `--host`, …), protocol fields, and brand tokens (`Drop`, `DropCli`) in English.
- Update existing CLI tests that assert English UI copy to expect the new pt-BR strings (no new test suites).

## Capabilities

### New Capabilities

<!-- none — UI language is a requirement change on existing CLI session behavior -->

### Modified Capabilities

- `cli/session`: Interactive labels, status/inbox copy, help text, and other user-facing CLI strings MUST be hardcoded pt-BR and align with web/desktop naming; host/join options MUST be exactly `Gerar um código` / `Possuo um código`.

## Impact

- Code: `native/cli` UI packages (`internal/ui/tui`, `internal/ui/quick`), and any user-printed strings in `cmd/dropcli` / runner paths.
- Specs: delta on `cli/session` (scenarios that currently name English "Host"/"Join" and implied English UI).
- Tests: existing string assertions in CLI UI/quick tests under `native/cli`.
- No protocol, signaling, or transfer behavior changes; no new dependencies; web/desktop unchanged.

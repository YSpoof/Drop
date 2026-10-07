# Tasks

## 1. String catalog

- [x] 1.1 Add `native/cli/internal/ui/text` (or equivalent) with pt-BR constants for shared web terms (`Gerar um código`, `Possuo um código`, `Nome de exibição`, `Pasta para downloads`, `Baixar`, `Remover`, `Copiar código`, `Configurações`) plus placeholders for CLI-only copy — verify package builds with `go test ./internal/ui/text/...` (or `go build` if no tests yet)
- [x] 1.2 Document in that package that web/desktop Svelte labels are the source of truth for overlapping names — verify comment/file header names the matching web strings

## 2. Interactive TUI

- [x] 2.1 Replace huh form titles/options/validation in `internal/ui/tui/form.go` with catalog strings (host/join MUST be exact web labels) — verify `go test ./internal/ui/tui/ -count=1` passes after updating any form-related assertions
- [x] 2.2 Translate inbox chrome, status feedback, and help line in `internal/ui/tui/inbox.go` (`Baixar`/`Remover`, copy feedback, etc.) — verify inbox tests (e.g. `inbox_copy_test.go`) expect pt-BR status text
- [x] 2.3 Translate connection/role/status labels in `internal/ui/tui/view.go` — verify package tests still pass and a quick manual View/render check shows pt-BR status words

## 3. Quick mode and CLI entry

- [x] 3.1 Translate flag help, `Usage`, and validation errors in `internal/ui/quick/runner.go` (`NewFlagSet` / `Validate*`) — verify `go test ./internal/ui/quick/ -count=1` and that `-h`/usage output is pt-BR while flag names stay English
- [x] 3.2 Translate operator-facing stdout/stderr lines in the quick runner (PIN assigned, peer joined, transfer progress, waiting-to-reconnect, etc.) — verify existing quick tests pass with updated string expectations
- [x] 3.3 Translate user-visible `error:` (or equivalent) output in `cmd/dropcli/main.go` if still English — verify `go build ./cmd/dropcli` succeeds

## 4. Sweep and integration check

- [x] 4.1 Grep `native/cli` for remaining English UI sentence literals outside tests/comments/protocol and fix stragglers — verify no leftover English operator strings in `internal/ui` and quick runner print paths
- [x] 4.2 Run `go test ./...` under `native/cli` and smoke interactive + quick host once — verify suite green and UI shows `Gerar um código` / `Possuo um código` / `Nome de exibição`

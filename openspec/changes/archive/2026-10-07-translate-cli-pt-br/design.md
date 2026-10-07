# Design

## Context

See proposal.md — Why. CLI lives under `native/cli` (Go). User-facing English is inlined today in `internal/ui/tui` (huh forms, inbox, connection/transfer renderers) and `internal/ui/quick` (flag help, usage, stdout/stderr). Web/desktop already hardcodes pt-BR labels in Svelte components (e.g. `Gerar um código`, `Possuo um código`, `Nome de exibição`, `Pasta para downloads`). No shared i18n package exists across TS and Go.

## Goals / Non-Goals

**Goals:**

- Hardcode pt-BR for every operator-visible CLI string, matching web/desktop names where the concept exists.
- Keep a single obvious place (or small set of places) for string constants so future copy edits stay cheap.
- Update existing tests that assert English UI copy.

**Non-Goals:**

- Locale detection, `LANG`/`LC_*` switching, or bilingual fallback.
- Translating comments, log-style internal `fmt.Errorf` wrappers not shown as primary UI, protocol payloads, or flag/identifier names.
- Sharing a message catalog with the Svelte app (different languages/runtimes).
- Changing session/transfer/signaling behavior beyond visible wording.

## Decisions

### 1. Inline pt-BR constants in Go, not a full i18n framework

**Choice:** Add a small `internal/ui/text` (or equivalent) package of exported string constants / helpers used by TUI and quick mode; replace English literals at call sites.

**Why:** Matches web/desktop “hardcoded locale” model; avoids pulling gettext/go-i18n for one language.

**Alternatives considered:**

- Per-file string edits only — works but duplicates and drifts.
- Full i18n with locale files — overkill given hardcode decision.

### 2. Terminology source of truth = web/desktop UI

**Choice:** For overlapping concepts, copy exact labels from web/desktop (`src/lib/components/...`), not invent CLI-only synonyms.

| Concept | Web/desktop label | CLI use |
| --- | --- | --- |
| Host session | `Gerar um código` | Interactive mode option |
| Join session | `Possuo um código` | Interactive mode option |
| Display name | `Nome de exibição` | Form / settings field title |
| Download folder | `Pasta para downloads` | Form / settings field title |
| Download action | `Baixar` | Inbox action / help |
| Remove action | `Remover` | Inbox action / help |
| Copy code | `Copiar código` | Host hint / related feedback |
| Settings | `Configurações` | Settings entry when shown |

CLI-only surfaces (quick-mode progress lines, connection status, usage blocks) get natural pt-BR consistent with that voice; brand `Drop` / `DropCli` stays.

**Alternatives considered:** Keep Host/Join English role words — rejected by product decision to match web exactly.

### 3. Scope of “user-facing”

**Includes:** huh titles/options/validation, inbox View/status, `renderConnectionInfo` labels, flag descriptions + `Usage`, quick runner lines printed for the operator, `main` `error:` prefix if kept user-visible.

**Excludes:** Wire JSON keys, Go identifiers, flag names (`-h`, `--host`), test fixture protocol reasons that are not UI, and deep wrapped errors only used as `%w` internals (surface message to user still pt-BR when that error is the primary printed failure).

### 4. Tests

**Choice:** Edit existing `*_test.go` expectations that pin English UI strings; do not add new test packages/files unless needed to keep compile green after renames (prefer editing assertions in place).

## Risks / Trade-offs

- [Scripted consumers parse English CLI stdout] → Mitigation: document as **BREAKING** user-visible change; flag names unchanged so automation that only uses flags still works.
- [Terminology drift vs web later] → Mitigation: central constants + comment pointing at web labels as source of truth.
- [Missed English string in a rarely used path] → Mitigation: inventory UI packages + grep for remaining English sentence-case literals during apply.

## Migration Plan

1. Land string constants + replace call sites in `native/cli`.
2. Fix existing UI/quick tests asserting English copy.
3. Manual smoke: interactive form labels, inbox help, `-h` usage, quick host PIN line.
4. Rollback = revert commit (no data migration).

## Open Questions

None — locale model and host/join labels decided by user (hardcode; match web exactly).

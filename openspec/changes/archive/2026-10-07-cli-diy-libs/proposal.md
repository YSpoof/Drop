# Proposal

## Why

CLI `go.mod` and `libs/` mix third-party packages that are easy to own in-house with packages that are genuinely hard to replace. That raises maintenance cost and makes local helpers look like drop-in forks of popular module names. Shrink the direct dependency surface to what we keep on purpose, and house small replacements under clear `dropcli/libs/...` names.

## What Changes

- Remove direct dependency on `github.com/atotto/clipboard`; replace with in-house `dropcli/libs/clip` (write-text-to-clipboard only).
- Keep direct third-party deps: Charmbracelet TUI (`bubbletea`, `huh`, `lipgloss`), Pion WebRTC, `gorilla/websocket`, `fsnotify`, and Go extensions `golang.org/x/sys` / `golang.org/x/term`.
- **BREAKING** (import paths only): rename `dropcli/libs/pty` → `dropcli/libs/ptypair` and `dropcli/libs/cancelread` → `dropcli/libs/breakread` so local packages do not mirror well-known upstream package names.
- Policy: new DIY packages use short `dropcli/libs/<name>` import paths; do not `replace` or re-register upstream module paths.

## Capabilities

### New Capabilities

- `cli/libs`: Rules for which CLI dependencies stay third-party vs in-house, naming of DIY packages under `dropcli/libs/`, and system clipboard write via the in-house clip helper.

### Modified Capabilities

- (none — copy-to-clipboard user flows already required by `cli/session` and `cli/donation-reminder`; this change swaps the implementation.)

## Impact

- Code: `native/cli/internal/ui/clipboard.go`, callers unchanged at the `ui.CopyToClipboard` boundary; `native/cli/libs/` gains `clip`, renames `pty`/`cancelread`; import updates in quick hostkeys (+ tests).
- Dependencies: drop `github.com/atotto/clipboard` from `go.mod`; keep websocket, fsnotify, TUI, WebRTC, `x/sys`, `x/term`.
- Behavior: clipboard success/failure semantics stay as today for PIN, share link, and PIX copy.
- Platforms: Drop CLI targets Linux and Windows only. `clip` implements those two; other GOOS (including Darwin) returns a clear error.

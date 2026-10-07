# Design

## Context

See proposal.md — Why. Today `native/cli` has two DIY packages (`libs/pty`, `libs/cancelread`) plus nine direct third-party requires. Clipboard is a one-function wrapper around `atotto/clipboard`. Signaling and folder watch already sit behind ports; only the clipboard adapter is a thin UI helper. Build tags already split Linux vs `!linux` for the DIY helpers.

## Goals / Non-Goals

**Goals:**

- Drop `atotto/clipboard`; own write-only clipboard under `dropcli/libs/clip`.
- Rename DIY packages away from familiar upstream names without changing behavior.
- Leave websocket, fsnotify, TUI, WebRTC, and `x/*` untouched.
- Keep `ui.CopyToClipboard` as the single call site for UI so keybindings and donation flows stay stable.

**Non-Goals:**

- Replacing Charmbracelet, Pion, gorilla/websocket, or fsnotify.
- Shrinking transitive deps pulled in by those kept packages.
- Clipboard read API, image clipboard, or OSC-52-only strategy as the sole backend.
- Changing copy UX copy strings or keybindings.

## Decisions

### 1. `clip` package API

- **Choice:** `dropcli/libs/clip` with `func Write(text string) error`. `ui.CopyToClipboard` becomes a one-line call into `clip.Write`.
- **Why:** Matches current use (write only). Short name, not `clipboard`.
- **Alternatives:** Keep logic inside `internal/ui` (harder to reuse/test); mirror atotto's full API (unused).

### 2. Clipboard backends by OS

- **Choice:**
  - Linux: try `wl-copy` (Wayland), then `xclip`, then `xsel` via `exec`; first success wins.
  - Windows: pipe text to built-in `clip.exe` via `exec` (stdin → clipboard).
  - Other (including Darwin): return a clear unsupported error — Drop CLI is Linux + Windows only.
- **Why:** Match product OS support. External tools / OS builtins avoid cgo. Preserves “error → UI failure feedback” contract.
- **Alternatives:** Also ship `pbcopy` (unused — no Darwin support); OSC-52 only; Win32 APIs via `x/sys/windows`; keep atotto (rejected by scope).

### 3. Rename `pty` → `ptypair`, `cancelread` → `breakread`

- **Choice:** Move directories and update package names/`Open`/`New` APIs in place (same signatures).
- **Why:** Import path `dropcli/libs/pty` still reads like creack; `cancelread` reads like muesli/cancelreader. Local role names stay short.
- **Alternatives:** Keep names (allowed by module path uniqueness, but fights the “don’t look like upstream” rule).

### 4. No `go.mod replace` for DIY

- **Choice:** Only `dropcli/libs/...` imports; never `replace github.com/... => ./libs/...`.
- **Why:** Spec requirement; avoids accidental public-path impersonation.

### 5. Out of scope keeps

- **Choice:** Leave `adapters/signaling` on gorilla and `adapters/watcher` on fsnotify.
- **Why:** User decision; both already behind ports if we DIY later.

## Risks / Trade-offs

- [Linux without wl-copy/xclip/xsel] → Copy fails; UI already handles error. Document in code comment; no silent success.
- [`clip.exe` missing / restricted Windows environments] → Return error; same UI failure path.
- [Behavior drift vs atotto on exotic setups] → Accept; cover Linux + Windows only.
- [Rename churn in tests] → Mechanical import updates; run focused `go test` on quick UI and libs.
- [Transitive tree still large] → Expected while TUI/WebRTC stay; not addressed here.

## Migration Plan

1. Add `libs/clip` with platform files; wire `ui.CopyToClipboard`.
2. Rename `libs/pty` → `libs/ptypair`, `libs/cancelread` → `libs/breakread`; fix imports.
3. `go mod tidy` to drop atotto; confirm direct requires match whitelist.
4. Run existing CLI unit tests; smoke copy PIN / PIX on Linux if available.

Rollback: restore atotto + old directory names (git revert of the change).

## Open Questions

None deferred — platform set for `clip` is Linux + Windows as above.

# Design

## Context

See proposal.md — Why. Today `InboxModel` (`native/cli/internal/ui/tui/inbox.go`) keeps a flat cursor over `PendingOffers()`, binds `"d", "enter"` to `SendPullBatch`, and has no Esc navigation (Esc only dismisses the Ctrl+C overlay). Offer names already carry relative paths from watched folders (`services.AnnounceName` / `meta.name`). `FinalizeDrop` already sanitizes relative paths, creates parent dirs, and collision-renames leaves — FS tree replication is mostly done; this change makes the inbox browse that tree and binds Enter/Esc to navigation.

## Goals / Non-Goals

**Goals:**

- Virtual directory stack in the inbox UI derived from pending `meta.name` segments.
- Enter / Esc / `..` navigation; Enter never downloads.
- Folder selection expands to descendant `fileId`s for `d` / `r` / Space / `a`.
- Spec + help text match new keybindings; keep pull/dismiss wire path unchanged.

**Non-Goals:**

- Changing announce/watch protocol or `meta` shape.
- Tree UI outside interactive inbox (quick mode stays auto-download).
- Lazy loading from peer (all pending offers already local).
- Persistent cwd across reconnect sessions (reset to root on new inbox program is fine).

## Decisions

### 1. Pure UI tree over pending offers (not a new service)

Build rows from `PendingOffers()` + current path prefix. No download-service “folder” entities.

- **Why:** Folders are virtual groupings of already-announced files; wire API stays per-`fileId`.
- **Alt:** Materialize folder nodes in `DownloadService` — rejected; couples transfer layer to TUI.

### 2. Path model

- Normalize names with `/` (same as announce).
- `cwd []string` path segments; root = empty.
- Visible rows at `cwd`:
  1. `..` if `len(cwd) > 0`
  2. Unique next-segment folder names among offers under prefix
  3. File offers whose remaining path is a single segment
- Sort: `..` first, then folders, then files (stable locale-simple string order).

### 3. Selection keyed by fileId; folders are view-time expansion

Keep `selected map[string]bool` keyed by `fileId`. Space on a folder toggles all descendant pending fileIds under that prefix. Checkbox on a folder row shows checked when all descendants are selected (unchecked/partial = not all). `..` ignored for Space/`a`.

- **Why:** `SendPullBatch` / `DismissPendingBatch` already take fileIds.
- **Alt:** Store selected folder prefixes separately — more state, same expansion at action time.

### 4. Keybindings

| Key | Behavior |
|-----|----------|
| Enter | Enter folder or `..`; no-op on file |
| Esc | Up one level if not root and not confirming; else no-op (confirm overlay still dismisses on Esc) |
| Space | Toggle file or expand-toggle folder |
| a | Toggle all selectable rows in **current view** (files + folders → descendant ids) |
| d | Pull target ids (selection, else cursor file/folder expansion) — **not** Enter |
| r / x | Dismiss same target expansion |

Update `text.InboxHelp` to mention Enter/Esc and that `d` downloads.

### 5. FS tree

Rely on existing `sanitizeRelativePath` + `EnsureDir` in `FinalizeDrop`. Spec adds explicit nested finalize + traversal rejection. No new finalize API unless gaps found during apply.

### 6. Cursor after navigation

On enter/up, reset cursor to 0 (`..` when present). Clamp when offer list shrinks. Prune selection when offers disappear (existing `pruneSelection`).

## Risks / Trade-offs

- [Enter muscle memory downloads] → Mitigation: help chrome + BREAKING note; `d` unchanged.
- [Partial folder selection UI unclear] → Mitigation: folder checkbox = all-descendants-selected only; no tri-state required for v1.
- [Esc vs confirm overlay] → Mitigation: keep confirm branch first; Esc-up only when `!confirming`.
- [Basename-only offers] → Mitigation: appear as root files; tree still works.
- [Name segment that is both file and folder] → Mitigation: treat as folder if any offer has a deeper segment with that name; rare; document in tasks if needed.

## Migration Plan

- Ship as CLI UX change; no config migration.
- Rollback = restore Enter→download and flat list.

## Open Questions

- None blocking; select-all scoped to current view recorded above as decision.

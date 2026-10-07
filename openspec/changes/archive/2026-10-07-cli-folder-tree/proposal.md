# Proposal

## Why

Interactive inbox lists every pending offer as a flat row, and Enter downloads like `d`. When peers send watched folders (`meta.name` paths such as `photos/nested/a.jpg`), that flat list is hard to browse. Inbox needs path-based folder navigation, with Enter reserved for entering folders and `d` for download.

## What Changes

- Inbox pending list becomes a path-segment tree derived from pending `meta.name` values (forward-slash paths).
- At each directory level, show immediate child folders and files only; include a leading `..` row when not at root.
- **Enter** enters the highlighted folder (or follows `..`); on a file, Enter is a no-op. Enter MUST NOT download.
- **Esc** goes up one directory level; at root, Esc is a no-op (Ctrl+C confirm overlay still uses Esc to dismiss).
- **Space** toggles selection on files and folders; selecting a folder selects all pending files under that folder (recursive).
- **`d` / `r`** operate on selected items, or the cursor row when nothing is selected; a folder target expands to all pending files under it.
- Downloaded files keep relative path segments under the download directory (tree replicated on disk).
- Help chrome updates for Enter/Esc navigation (pt-BR).
- **BREAKING** (keybinding): Enter no longer downloads from the inbox.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `cli/session`: Interactive receive inbox presents a folder tree, remaps Enter/Esc for navigation, and expands folder selection/download/remove to descendant files.
- `cli/file-transfer`: Finalize received files under the announced relative `meta.name` path inside the download directory (create parent dirs; collision-safe leaf names).

## Impact

- `native/cli/internal/ui/tui/inbox.go` — cursor model, keybindings, view rows (`..`, folders, files).
- `native/cli/internal/ui/text/text.go` — inbox help / status strings.
- Host inbox keybinding requirement text (Enter/Esc semantics).
- Download finalize already creates parent dirs via `FinalizeDrop`; confirm/spec that behavior and cover nested names in scenarios if missing.
- No wire-protocol changes; still per-`fileId` pull/dismiss.

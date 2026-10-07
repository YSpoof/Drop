# Proposal

## Why

After a peer disconnect mid-download, interactive mode leaves a failed transfer row labeled in English (`peer lost`) and, when the sender reconnects and re-announces the same file under a new `fileId`, the inbox waits for a manual pull and appends a second active row. Partial `.drop` resume already works on the wire; users still have to re-select and the transfer history doubles.

## What Changes

- In **interactive** (manual download) mode, when an inbound `meta` carries a Drop identity `hash` that still has a retained incomplete `{hash}.drop` in the download directory, the CLI SHALL auto-`pull` that offer (same path as pressing `d`) without user selection.
- User dismiss/remove (`r` / `download-aborted`) continues to delete the partial and MUST NOT auto-resume that identity when it is re-announced later in the session.
- Peer-loss failure reason shown in the transfer list SHALL be pt-BR: `conexão perdida` (not English `peer lost`).
- When a receive for the same identity hash resumes (new `fileId`), the prior failed/peer-loss transfer row for that hash SHALL be replaced/updated in place so the list keeps one row for that identity (yellow/active over red/failed), keeping history small.
- Quick mode is out of scope (already auto-downloads).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `cli/file-transfer`: Auto-pull on re-announce when a matching incomplete `.drop` exists; consolidate transfer-state rows by identity hash when a receive resumes after peer loss.
- `cli/session`: Peer-loss transfer status string and inbox transfer-list presentation (pt-BR `conexão perdida`; single row per resumed identity).

## Impact

- `native/cli/internal/services/download.go` — detect retained `.drop` on `HandleMeta` in manual mode; trigger auto-pull; map/replace transfer entries by hash.
- `native/cli/internal/services/transfer.go` — wire auto-pull via existing `SendPull` / `SendPullBatch`; peer-loss status strings.
- `native/cli/internal/state/transfer.go` — replace/remove prior failed receive row for same identity when a new `fileId` takes over (may need hash tracked on `FileTransfer` or a side index).
- `native/cli/internal/ui/text/text.go` + `tui/view.go` — pt-BR reason string for peer loss.
- Interactive inbox wiring (`quick/runner.go` inbox path / transfer service callbacks) so auto-pull runs without user keypress.
- Existing resume protocol (`resume` + `{hash}.drop`) unchanged; this change is receive UX + transfer-list identity.

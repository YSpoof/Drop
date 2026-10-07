# Design

## Context

See proposal.md — Why. Wire-level resume already works: peer-loss keeps `{hash}.drop`, and `DownloadService` computes resume offsets / sends `resume`. Gaps are interactive UX only:

1. Manual mode always parks new `meta` as pending until `SendPullBatch`.
2. `InterruptReceives("peer lost")` stores an English reason rendered by the TUI.
3. `TransferState` keys rows by `fileId`; reconnect re-announces a new id → second row for the same identity.

Trigger for auto-resume (decided): incomplete `{hash}.drop` with `0 < size < fileSize` (`GetDropResumeOffset` > 0). Dismiss deletes the partial, so re-announce stays manual.

## Goals / Non-Goals

**Goals:**

- Auto-pull in manual/interactive mode when inbound `meta.hash` has a retained incomplete `.drop`.
- Show `conexão perdida` on peer-loss failed receives.
- One transfer-list row per identity hash across peer-loss → resume.
- Reuse existing pull / resume / credit paths.

**Non-Goals:**

- Changing quick-mode auto-download.
- Auto-pull without a retained partial (including after dismiss).
- Matching by name/size when hash differs or is empty.
- Changing Drop wire protocol shapes.
- Persisting dismissed-hash blocklists across process restarts (disk partial absence is enough).

## Decisions

### 1. Auto-pull inside download/transfer layer after HandleMeta

**Choice:** After registering a manual pending offer in `HandleMeta`, if `dropResumeOffset(meta) > 0`, invoke the same pull path as inbox `d` (`PreparePull` + `pull-batch`) asynchronously from the transfer service (or a small callback the interactive runner registers).

**Why:** Keeps eligibility next to resume-offset logic; inbox stays dumb about “should I pull?”.

**Alternatives:** Inbox watches pending offers and auto-presses pull — couples UI to resume policy; easier to miss non-TUI paths.

### 2. Eligibility = retained incomplete `.drop` only

**Choice:** Use existing `GetDropResumeOffset` / `dropResumeOffset`; no separate “was peer-lost” flag.

**Why:** Matches product decision (option B); dismiss already deletes partial → no auto-resume; different peer already wipes all `*.drop`.

**Alternatives:** Track failed `fileId`/hash set in memory — redundant with disk and drifts after restarts within session edge cases.

### 3. Track identity hash on transfer rows; replace on AddTransfer

**Choice:** Add `Hash` (or equivalent) on `state.FileTransfer`. On `AddTransfer` for a receive with non-empty hash, remove any prior receive row(s) for that hash that are failed/cancelled-with-peer-loss/pending leftover, then insert/update the new `fileId` row (preserve list position of the replaced entry when practical).

**Why:** UI renders `GetAll()`; consolidating in state fixes inbox and any other consumer without view-layer dedupe.

**Alternatives:** Filter duplicates only in `renderTransferItem` / inbox view — history still bloated in state; tests harder.

### 4. Peer-loss reason via `text` package

**Choice:** Constant `text.PeerLost` / `ErrPeerLost = "conexão perdida"`; pass that into `InterruptReceives` and any `SetStatus(..., "peer lost")` paths that surface in the TUI. Internal `errors.New("transfer aborted: peer lost")` for Go errors MAY stay English (not user-facing chrome) or share the same string if already shown — prefer pt-BR only for values stored in `FileTransfer.Error` that the TUI renders.

**Why:** Aligns with hardcoded pt-BR UI requirement; centralizes copy.

### 5. Avoid double-pull races

**Choice:** After deciding auto-pull, remove from pending / `PreparePull` before sending control, same as manual `SendPullBatch`. Ignore “no pending offer” if a concurrent user pull already started.

**Why:** User might press `d` in the same tick the meta arrives.

## Risks / Trade-offs

- **[Risk]** Auto-pull fires for any leftover `.drop` from an older interrupted receive in the same peer session, even if the user never intended to finish it (but did not dismiss). → **Mitigation:** Accepted; dismiss is the opt-out. Different peer already clears all partials.
- **[Risk]** Hash empty on `meta` → cannot auto-resume or consolidate. → **Mitigation:** Keep current manual behavior; Drop peers always send hash.
- **[Risk]** Replacing rows mid-render flickers. → **Mitigation:** Single state update under one lock before UI tick.
- **[Trade-off]** Auto-pull from service layer means interactive runner must have transfer service ready when first post-reconnect `meta` arrives (already true today for inbox).

## Migration Plan

No migration. Deploy with CLI binary update. Existing orphan `.drop` files become auto-resume triggers on next matching announce (desired).

## Open Questions

None that block implementation.

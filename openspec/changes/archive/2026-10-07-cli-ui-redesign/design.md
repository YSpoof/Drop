# Design

## Context

See proposal.md for motivation. Today `InboxModel.View` stacks unbounded pending rows + transfer lines + a static help string; `width`/`height` are stored but unused for clipping. Transfer rows are single-line. Signaling already emits optional `lan` on `peer-joining` / `join-accepted` (Drop web → `connectedViaLan` badge); CLI types ignore it. Forms/donation use `huh` separately from the bubbletea inbox.

Official keybinds stay: ↑/↓, Enter/Esc (folders), Space, `a`, `d`, `r`/`x`, `c`/`C`, `q`, Ctrl+C. Add `f` search. Drop undocumented `j`/`k`. Footer-only help. pt-BR only.

## Goals / Non-Goals

**Goals:**
- Height-budgeted dashboard for inbox (header / pending / transfers / footer).
- Scroll + search over pending tree rows.
- Prettier transfer rows (bar, speed, ETA) without new transfer controls.
- Plumb signaling `lan` into peer/session state for optional LAN header badge.
- Shared visual tokens across inbox, confirm, host wait chrome, huh forms, donation.

**Non-Goals:**
- Remap existing action keys; `?` help overlay; transfer pause UX.
- Redesign quick-mode stdout printer into a TUI.
- ICE-based LAN detection (signaling flag only, same as web).
- New TUI dependencies beyond Charmbracelet.

## Decisions

### 1. Layout engine inside existing Bubble Tea inbox
**Choice:** Keep `InboxModel` as the session TUI; introduce layout helpers that allocate rows from `tea.WindowSizeMsg` (header fixed, footer measured, remaining split pending vs transfers with a minimum for each).  
**Alt:** Full rewrite on bubbles viewport components — heavier, more churn for same outcome.  
**Why:** Least disruption to key handling / tests; height math is the main gap.

### 2. Scroll window over `visibleRows()`
**Choice:** Track `scrollOffset`; clamp so cursor stays in the visible window; render only `[offset, offset+page)`. Scroll indicator like `3–8 / 42` or `8/42`. Folder tree + cwd logic unchanged.  
**Alt:** Flatten all offers for search only — rejected for browse mode (tree stays).

### 3. Search mode as inbox sub-state
**Choice:** `searching bool` + query string; filter rows (files under cwd and/or full pending names — prefer match on full `meta.name` and folder segment names case-insensitive). Esc clears search; Enter exits search keeping cursor on chosen row; `d`/`r`/Space still work on current target while searching if simple, else defer to post-confirm — prefer: while searching, navigation+Esc+Enter only, other actions apply to highlighted result (same as browse) to avoid dead keys.  
**Assumption recorded:** Search filters the current tree level first; if query non-empty and no local hits, also surface matching files from deeper paths as flat results (basename + path hint) so `f` remains useful in nested trees.  
**Alt:** Global fuzzy finder overlay — more UI; skip for v1.

### 4. Transfer row rendering
**Choice:** Multi-line compact block per transfer in `renderTransferItem`: name+direction, progress bar + %, bytes + speed + ETA. ETA = remaining/speed when speed > 0. Cap how many transfer blocks fit in panel (newest/active first).  
**Alt:** Keep one-liners with more fields — worse scanability.

### 5. LAN badge plumbing
**Choice:** Add `Lan bool` to signaling message structs and `SignalingPeerInfo` (or parallel callback arg); store on `PeerState` (`viaLan bool`, cleared on peer clear). Header shows a LAN badge only when true (same-network hint, like Drop web). Missing/`false` → no WAN/WebRTC path label.  
**Alt:** Infer from ICE host/srflx — diverges from web; out of scope.

### 6. Cross-screen consistency
**Choice:** Shared lipgloss tokens in `tui/view.go` (or small `theme.go`): title, accent, dim, ok/warn/err. Inbox/confirm use them directly. Huh forms/donation: set huh theme colors / title styles to the same palette and refresh empty/copy strings for empty-state tone. Host PIN wait: print/status paths that are interactive-adjacent get the same status vocabulary (● Conectado / etc. in pt-BR).  
**Alt:** Rewrite forms in bubbletea — large scope; not required for visual consistency.

### 7. Remove `j`/`k`
**Choice:** Delete `j`/`k` cases from inbox `Update`; help text never lists them.  
**Why:** User never wanted them; scenarios assert they do not move the cursor.

## Risks / Trade-offs

- [Small terminals starve panels] → Enforce minimums; collapse transfers to one line / hide ETA before dropping pending list or footer.
- [Search vs folder tree ambiguity] → Documented assumption: cwd-first filter, then deeper flat matches; revisit if UX feels wrong.
- [Huh theme limits] → Best-effort palette + copy; not pixel-identical to lipgloss panels.
- [LAN only at pair time] → Same as web; reconnect re-pair refreshes flag from new join messages.

## Migration Plan

No protocol break. Ship behind normal CLI release. No config migration. Rollback = revert UI/signaling parse commits.

## Open Questions

None blocking — search deeper-match behavior above is the recorded assumption for implementers.

# Proposal

## Why

Interactive DropCli screens still read like stacked status lines: inbox grows without a height budget, transfers are hard to scan, and chrome does not match a modern TUI app (lazygit/yazi-class hierarchy). Redesign toward a bounded dashboard while keeping existing keybinds and pt-BR copy.

## What Changes

- Rebuild interactive chrome as a responsive dashboard (header / content / footer) that never renders outside the terminal viewport; panels resize on `WindowSize`.
- Inbox: scrollable pending-offer list (folder tree unchanged), distinct cursor vs selection, dedicated empty states, compact multi-line transfer rows (progress bar, bytes, speed, ETA when known).
- Add incoming-file search with **`f`** (lowercase): filter/navigate by filename; Esc leaves search; Enter confirms and returns to normal nav; ↑/↓ move results. Footer advertises `f`.
- Keep official keybinds: ↑/↓ navigate, Enter folder / Esc up, Space mark, `a` all, `d` baixar, `r`/`x` remover, `c` PIN, `C` link, `q` sair, Ctrl+C confirm. **Do not** remap to directions-doc alternatives (no Enter-download, no `L` for link, no `?` help overlay).
- Remove undocumented `j`/`k` navigation aliases (never part of intended keybinds).
- Header: compact connection state, peer name, PIN; optional LAN badge from signaling `lan` (same public-IP detection as Drop web) — no WAN/WebRTC path labels.
- Footer: contextual hints only (browse vs search); stay footer-only (no `?` help screen).
- Apply the same visual language across **all** interactive surfaces: inbox, host PIN wait / reconnect chrome, confirm overlay, mode/PIN/settings forms, donation reminder.
- Language remains hardcoded pt-BR; directions English mockups are layout reference only.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `cli/session`: interactive TUI layout, resize/overflow rules, scrollable inbox, search (`f`), transfer row presentation, empty states, footer/header chrome, keybind surface (add `f`, drop `j`/`k`), visual consistency across interactive screens.
- `cli/signaling`: parse and expose optional `lan` on `peer-joining` / `join-accepted` (server already sends it) so the UI can show a LAN badge like Drop web.

## Impact

- Code: `native/cli/internal/ui/tui/*` (inbox, view, confirm, form, donation), `native/cli/internal/ui/text`, host PIN-wait / quick runner chrome paths that paint interactive status, peer/session state for LAN flag, signaling message types + handler wiring.
- Specs: `cli/session`, `cli/signaling`.
- Deps: stay on Charmbracelet (`bubbletea` / `lipgloss` / `huh`); no new TUI libraries.
- Non-goals: quick-mode line printer redesign beyond shared status labels if any; transfer pause/cancel UX; English UI; remapping existing action keys.

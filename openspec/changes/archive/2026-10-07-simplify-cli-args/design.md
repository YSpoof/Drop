# Design

## Context

See proposal.md for motivation. Today `quick.NewFlagSet` registers short+long flags for quick/host/connect/file/dir/output/name/url; `main.run` branches only on `cfg.Quick`, and interactive always rebuilds config from the TUI form (ignoring most launch flags). Host is `-h`, which collides with conventional help. Send is single `-f` or watch `-d`. `DROP_WS_URL` already exists in `state.Settings`; `-url` is a redundant override.

## Goals / Non-Goals

**Goals:**
- Shrink parse surface to `-q -s -c -o -h` plus positionals.
- Support multi-file send-once and directory watch via argv positionals.
- Compose flags with interactive UI when `-q` is absent.
- Keep auto-download coupled to `-q` only (no `-a`).

**Non-Goals:**
- Changing WebRTC/signaling wire protocol.
- Redesigning inbox UX beyond applying launch role/paths/output.
- Adding long-form flag aliases back.
- Locale / English UI work (already pt-BR).

## Decisions

1. **Host flag `-s`, help `-h`**  
   Rename host from `-h` to `-s` (“share”). Leave `-h` / `-help` / `--help` for usage via FlagSet help behavior (define `-h` as help or rely on default help after removing host from `-h`).  
   *Alternative considered:* keep `-h` host and document `-help` only — rejected; user wants `-h` = help.

2. **Short flags only**  
   Register only `-q`, `-s`, `-c`, `-o` (plus help). No `BoolVar`/`StringVar` dual long names.  
   *Alternative:* keep long forms for migration — rejected to minimize surface.

3. **`QuickConfig` paths model**  
   Replace `File`/`Dir` strings with `Paths []string` (raw positionals) plus derived `SendFiles []string` and `WatchDirs []string` after validation. Classify each path as file or dir; allow any mix (including multiple dirs). Reject only missing/invalid paths.  
   *Alternative:* keep `-f`/`-d` internally while accepting positionals — unnecessary indirection.

4. **Multi-file send + multi-dir watch**  
   After ready: enqueue all `SendFiles`, drain queue (existing `TransferService`). If `WatchDirs` empty, MAY exit after successful send-once (same reconnect/retry rules as single-file). If any watch dir: start recursive watchers for each and stay until cancel; still send file positionals once without treating that completion as session end. Order among files unspecified.  
   *Alternative:* parallel sends — out of scope; keep sequential drain.

5. **Interactive without `-q`**  
   In `main.run`: if `!cfg.Quick` but `-s`/`-c`/`-o`/paths present, skip or partially skip `RunForm` (skip mode/PIN when role known; apply `-o`; keep settings entry available from bare launch). Pass `ReceiveInbox: true`, `AutoDownload: false`, and path fields into `Runner.Run`.  
   *Alternative:* always run full form then override — worse UX when role already given.

6. **Paths without role**  
   Run interactive mode selection; stash positionals on config; after form → runner, apply queued sends once ready (interactive send path may need a small TUI-or-runner hook if today only quick send loops handle `-f`). Prefer reusing runner send/watch loops under interactive inbox session where feasible; if inbox + outbound send conflict, send queued files via the same transfer service after ready while inbox remains for inbound.  
   *Assumption recorded:* outbound queued sends and inbound inbox can coexist in one session (same as a peer that both sends and receives).

7. **URL env-only**  
   Remove `WSURL` from flag parsing and `main` override from args. Settings continue to read `DROP_WS_URL` at construction.  
   *Alternative:* keep `-url` for local dev — rejected; env is enough.

8. **Device name**  
   Remove `-name`. Settings/`RunConfigMenu` already edit name + reset stats — keep as the only launch-time-adjacent editor.

## Risks / Trade-offs

- **[Risk] Scripts using `-h` for host break** → Mitigation: usage text + migration notes in proposal; clear help synopsis with `-s`.
- **[Risk] Interactive + queued send under-tested** → Mitigation: tasks cover main composition paths; reuse runner send loops.
- **[Risk] Go `flag` default `-h` help vs custom Usage** → Mitigation: verify `-h`/`-help` print custom pt-BR usage, not English default only.
- **[Trade-off] No long aliases** → shorter UX, harsher breakage for anyone who used `--host`.

## Migration Plan

1. Land breaking CLI parse change in one release (no compatibility shim).
2. Update usage strings and any repo docs/examples (`-q -h -f` → `-q -s file`, `-url` → `DROP_WS_URL`).
3. Rollback = revert commit; no data migration (config file unchanged except unused fields already ignored).

## Open Questions

- None material; mix allowed with stay-alive-if-any-dir, and unspecified multi-file order, recorded as assumptions above.

# Design

## Context

See proposal.md for why. Current `Dockerfile`:

1. `go-clients` — copies only Go trees, cross-compiles streamer + CLI (already cache-friendly).
2. `native` — `pnpm i`, then `COPY . .`, then copies streamer from `go-clients`, then `native:update` + `native:build`.
3. `build` — full web tree, copies desktop from `native` and CLI from `go-clients` into `static/downloads/`, runs `pnpm run build`.

Observed cache break: `native`’s `COPY . .` checksum includes frequent web paths (`src/`, etc.). Neutralino shell loads remote `https://drop.lzart.com.br` (`neutralino.config.json`); packaging does not need the SvelteKit app tree. `.dockerignore` already drops some noise (`tests`, `dist`, downloads) but not `src/` or `openspec/`.

## Goals / Non-Goals

**Goals:**

- Keep `go-clients` → `native` → `build` dependency order.
- Make `native` layer inputs stable across web-only edits.
- Preserve published `/downloads/` filenames and streamer-before-embed semantics when native/Go inputs change.

**Non-Goals:**

- Changing Neutralino URL/mode, embed flags, or runtime shell behavior.
- Speeding Go module download beyond existing stage structure.
- Restructuring pnpm workspace or local (non-Docker) `native:build` developer scripts.
- BuildKit cache mounts / remote cache registry setup (nice later; not required for this change).

## Decisions

### 1. Replace `COPY . .` in `native` with explicit native inputs

Copy only what Neutralino packaging needs, then overlay Go-built streamers:

- Lock/workspace: `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- Config: `neutralino.config.json`
- Icon referenced by config: `static/images/pwa/512.png` (window mode icon path)
- Any other paths packaging actually reads (confirm during apply if `neu` fails without them)
- `COPY --from=go-clients` into `native/extensions/compiled/` **before** `native:build` (order already correct; keep it after the narrow COPY so streamer layers stay tied to Go outputs)

**Why:** Docker invalidates from the first changed COPY. Narrow COPY = web edits skip `native:build`.

**Alt:** Broaden `.dockerignore` to exclude `src/` globally — rejected as sole fix; `build` stage needs `src/` via `COPY . .`. Ignore rules would break web stage unless that stage switches to explicit copies too (larger blast radius).

**Alt:** Split repo contexts / multiple Dockerfiles — rejected; overkill for one cache boundary.

### 2. Keep full-tree `COPY . .` on the web `build` stage

Web stage still needs app sources. It continues to pull artifacts with `COPY --from=native` and `COPY --from=go-clients`. No need to reorder those copies relative to each other for this goal.

### 3. Optional `.dockerignore` hygiene only if it helps without harming `build`

Safe extras (e.g. `openspec/`, agent dirs) can be ignored if neither `native` nor `build` needs them in-image. Do not ignore `src/`. Prefer explicit native COPY over relying on ignore lists for the cache contract.

### 4. Validate with two docker builds

After apply: (1) baseline build, (2) touch a web-only file and rebuild — confirm `native` / `go-clients` cache hits and `build` reruns; then touch `neutralino.config.json` and confirm `native` rebuilds.

## Risks / Trade-offs

- **[Risk]** Narrow COPY omits a file `neu` needs → packaging fails. → **Mitigation:** Fail apply on first `docker build`; add the missing path explicitly; keep list small.
- **[Risk]** `--embed-resources` with `documentRoot: "/"` previously embedded accidental web files; narrowing context changes package contents. → **Mitigation:** Acceptable for remote-UI shell; smoke-launch packaged binary still connects to production URL / embeds streamer.
- **[Trade-off]** Explicit COPY list must be updated when native packaging gains new file deps. → Document in Dockerfile comments next to the COPY block.

## Migration Plan

1. Edit `Dockerfile` `native` stage only (plus optional `.dockerignore`).
2. Run production `docker build`; confirm four `/downloads/` artifacts land in the web image.
3. No runtime deploy migration; rollback = revert Dockerfile.

## Open Questions

None material for planning; during apply, confirm exact minimal file set if `neu build` errors on missing paths.

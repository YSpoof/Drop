# Design

## Context

See proposal.md — Why. Today:

- Streamer Go module at `extensions/streamer`, binaries in `extensions/compiled/`, Neutralino `resourcesPath` `/extensions/compiled/`, extract path `/extensions/compiled/...` in `neutralinoClient.ts`.
- Desktop packages built in Docker `native` stage → copied to `static/downloads/`; streamer binaries are currently prebuilt in-tree, not rebuilt in that stage.
- Install modal (`InstallAppButton.svelte`) shows desktop Windows/Linux + PWA card; `siteData.desktopDownloads` only.
- CLI source lives outside this repo at `/home/zero/Projects/Ours/dropCli` (`module dropcli`).

## Goals / Non-Goals

**Goals:**

- Single `native/` tree for desktop-related Go + Neutralino assets (`cli/`, `extensions/`).
- One Docker/CI path builds streamer, CLI, and desktop, then serves CLI + desktop from `/downloads/`.
- Modal UX: product → OS downloads; PWA under Aplicativo; no mac native/CLI binaries.

**Non-Goals:**

- Rewriting CLI protocol or UI beyond path/module placement.
- Publishing macOS native or CLI artifacts.
- Automating deletion of the external `dropCli` repository.
- Merging CLI OpenSpec history/changes archives from dropCli (requirements only).

## Decisions

### 1. Layout under `native/`

```
native/
  cli/                 # copied from dropCli (cmd/, internal/, go.mod, go.sum, …)
  extensions/
    streamer/          # moved from extensions/streamer
    compiled/          # build output (streamer-*)
```

**Rationale:** Matches user path choice; groups Neutralino-adjacent Go away from web `src/`.

**Alternatives:** Keep top-level `extensions/` — rejected (user wants `native/extensions`). Submodule to dropCli — rejected (copy, then retire).

### 2. Copy CLI as-is; keep `module dropcli`

Copy `cmd/`, `internal/`, `go.mod`, `go.sum`, and any non-OpenSpec project files needed to build. Keep Go module path `dropcli` so imports stay valid without a mass rename. Do not copy dropCli’s `.git`, `.agents`, or its own `openspec/changes` archives into `native/cli/`; CLI requirements land in this repo’s OpenSpec under `cli/*`.

**Alternatives:** Rename module to `drop/cli` — more churn, no user value for this change.

### 3. Docker: dedicated Go stage, then native + web

Add a `golang` build stage (or install Go on an intermediate image) that:

1. Builds streamer → `native/extensions/compiled/{streamer-linux_x64,streamer-win_x64.exe}` (`CGO_ENABLED=0`, `GOOS`/`GOARCH` as today).
2. Builds CLI → `/out/downloads/{Drop-cli-linux_x64,Drop-cli-win_x64.exe}`.

Native stage consumes compiled streamers (via updated `resourcesPath`), runs `native:build`, copies desktop + CLI into `static/downloads/`. Web build stage unchanged aside from richer downloads folder.

Scripts: point `scripts/build-streamer.sh` at `native/extensions/streamer`; add `scripts/build-cli.sh` (or one `scripts/build-go-clients.sh`) for local parity with CI.

**Alternatives:** Commit prebuilt binaries only — rejected (user wants CI builds). Build Go inside the Neutralino Node stage without a clear Go image — messier caching.

### 4. Neutralino path updates

- `neutralino.config.json` `cli.resourcesPath`: `/native/extensions/compiled/` (or Neutralino-relative equivalent that embeds that folder).
- `neutralinoClient.ts` `sourcePath`: same resource path prefix as `resourcesPath`.
- Any docs/scripts referencing `extensions/` updated.

Runtime streamer behavior unchanged; only filesystem/resource locations move.

### 5. Install modal two-step UX

State machine in `InstallAppButton.svelte` (or small child component):

1. `product = null` → cards **CLI** / **Aplicativo**.
2. `product = "cli" | "app"` → Windows + Linux links for that product; Aplicativo also shows buried PWA control (not a peer card to CLI).
3. Back control returns to product choice.

`siteData` gains `cliDownloads: { windows, linux }` alongside existing desktop URLs. Filenames per `client-downloads` spec.

`isWindowsOrLinux()` gating stays: Windows/Linux open this modal; other platforms keep PWA-prompt-only behavior (mac without native binaries).

**Alternatives:** Tabs for product — worse progressive disclosure. Separate modals — more chrome.

### 6. Compiled artifacts and git

Prefer not relying on committed streamer binaries after CI builds them: gitignore `native/extensions/compiled/*` (and keep `/static/downloads/`). Local `pnpm streamer:build` / `native:dev` still produce them. If a short transition needs checked-in binaries, treat as temporary — CI remains source of truth for release images.

### 7. OpenSpec import paths

Import dropCli capabilities as new specs:

| dropCli | this repo |
|---------|-----------|
| `cli-session` | `cli/session` |
| `file-transfer` | `cli/file-transfer` |
| `signaling` | `cli/signaling` |

Avoids colliding with web `file-transfer`.

## Risks / Trade-offs

- **[Docker image size / build time]** Go toolchain + cross-compile lengthens CI → Mitigation: cache Go module downloads; keep `CGO_ENABLED=0`; reuse one Go stage for streamer + CLI.
- **[Neutralino resourcesPath break]** Wrong path → streamer missing at runtime → Mitigation: verify extract path matches config in native smoke / manual package start.
- **[Copy drift from dropCli]** Last-minute dropCli commits missed → Mitigation: copy from current tree at apply time; confirm `go build` for both targets before merge.
- **[Module name `dropcli` inside drop repo]** Mild naming oddity → Acceptable vs import churn.

## Migration Plan

1. Create `native/`, move `extensions/` → `native/extensions/`, copy CLI → `native/cli/`.
2. Update scripts, Neutralino config, extract path, package scripts.
3. Extend Dockerfile Go + downloads; confirm image serves all four `/downloads/` files.
4. Ship modal + `siteData` updates.
5. After merge/deploy, archive/delete external `dropCli` repo manually.

Rollback: revert change; old image still has desktop-only downloads. No DB migration.

## Open Questions

None blocking. Optional later: whether to rename Go module `dropcli` → `drop/cli` in a follow-up.

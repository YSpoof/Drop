# Tasks

## 1. Native tree layout

- [x] 1.1 Create `native/extensions/` by moving `extensions/streamer` and `extensions/compiled` (remove empty top-level `extensions/`) and verify `native/extensions/streamer/go.mod` exists and nothing still imports the old `extensions/` path via `rg "extensions/" --glob '!openspec/changes/**'`
- [x] 1.2 Copy buildable CLI sources from `/home/zero/Projects/Ours/dropCli` into `native/cli/` (`cmd/`, `internal/`, `go.mod`, `go.sum`, plus any other files required to build; exclude `.git`, `.agents`, dropCli `openspec/`) and verify `test -f native/cli/go.mod && test -d native/cli/cmd/dropcli`

## 2. Local Go build scripts

- [x] 2.1 Update `scripts/build-streamer.sh` (and `package.json` `streamer:build` if needed) for `native/extensions/streamer` → `native/extensions/compiled/` and verify `pnpm streamer:build` produces `streamer-linux_x64` and `streamer-win_x64.exe` there
- [x] 2.2 Add `scripts/build-cli.sh` and a `package.json` script that cross-compiles CLI to `Drop-cli-linux_x64` / `Drop-cli-win_x64.exe` under a local out dir (e.g. `static/downloads/` or `/tmp`) with `CGO_ENABLED=0` and verify both binaries are created and `file` reports linux/windows executables
- [x] 2.3 Gitignore `native/extensions/compiled/*` (and keep `/static/downloads/`) if binaries should not be tracked, and verify `git check-ignore` matches those paths

## 3. Neutralino packaging paths

- [x] 3.1 Point `neutralino.config.json` `cli.resourcesPath` at `/native/extensions/compiled/` and verify the JSON still parses and that field matches
- [x] 3.2 Update `neutralinoClient.ts` extract `sourcePath` to the same resources prefix and verify `rg "extensions/compiled|/native/extensions/compiled" src/lib/adapters/native/neutralinoClient.ts` shows only the new path
- [x] 3.3 Run `pnpm streamer:build && pnpm native:build` (or the project’s equivalent) and verify the packaged app embeds the streamer from the new resources path without looking under top-level `extensions/`

## 4. Docker / CI publish

- [x] 4.1 Add a Go build stage to `Dockerfile` that compiles streamer into `native/extensions/compiled/` and CLI into download filenames `Drop-cli-linux_x64` / `Drop-cli-win_x64.exe`, then wire those into the native/web stages so `static/downloads/` receives desktop + CLI artifacts, and verify `docker build` succeeds
- [x] 4.2 Confirm the built image/web output contains `/downloads/Drop-linux_x64`, `/downloads/Drop-win_x64.exe`, `/downloads/Drop-cli-linux_x64`, and `/downloads/Drop-cli-win_x64.exe` (list the downloads directory from the build output or container)

## 5. Install modal + site data

- [x] 5.1 Extend `siteData` with `cliDownloads.windows` / `cliDownloads.linux` pointing at the CLI `/downloads/` filenames and verify TypeScript check includes the new fields (`pnpm check` or targeted typecheck)
- [x] 5.2 Rework `InstallAppButton.svelte` to product choice (CLI | Aplicativo) then OS links, bury PWA under Aplicativo, keep macOS without native/CLI binary offers, and verify on Windows/Linux desktop viewport: product step → each product shows only its Windows/Linux links; Aplicativo still exposes PWA as secondary
- [x] 5.3 Run Svelte autofixer / project check on the touched Svelte/TS files and verify no new errors from this change

## 6. Integration smoke

- [x] 6.1 From a clean tree, run streamer + CLI local build scripts and verify all four download artifact names exist where the web app expects them
- [x] 6.2 Spot-check that opening the install modal still hides the FAB in standalone display-mode and that choosing CLI vs Aplicativo only shows that product’s OS downloads

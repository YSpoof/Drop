# Proposal

## Why

Drop’s Go CLI lives in a separate repo (`dropCli`) while the main monorepo already ships web, backend, and native desktop. Splitting clients blocks a single CI pipeline for Go artifacts and leaves the install modal desktop-only. Folding the CLI in lets one build produce desktop + CLI downloads and present them clearly.

## What Changes

- Copy Go CLI source from `/home/zero/Projects/Ours/dropCli` into this repo at `native/cli/` (separate `dropCli` repo retired after copy).
- Move existing streamer extension tree from `extensions/` to `native/extensions/` and update Neutralino/build references.
- Bring dropCli OpenSpec capabilities into this project under `cli/*` (avoid colliding with existing web `file-transfer`).
- CI/Docker builds both Go targets (streamer extension + CLI) for linux/windows x64 alongside the existing native desktop package, and publishes CLI binaries next to desktop under `/downloads/`.
- Redesign install modal: first choose **CLI** or **Aplicativo**; each choice shows Windows/Linux download links. PWA stays buried under Aplicativo. macOS has no native/CLI downloads (PWA only if the browser offers install).

## Capabilities

### New Capabilities

- `cli/session`: Interactive and non-interactive CLI host/join/config UX (from dropCli `cli-session`).
- `cli/file-transfer`: CLI WebRTC transfer, flow control, and folder watching compatible with Drop peers (from dropCli `file-transfer`).
- `cli/signaling`: CLI signaling WebSocket, PIN pairing, and FastRTC signal relay (from dropCli `signaling`).
- `client-downloads`: Install-modal product choice (CLI vs Aplicativo), OS-specific download links, and served artifact paths/names.

### Modified Capabilities

- `native-file-streamer`: Streamer lives under `native/extensions`; packaged extract/build paths and CI must build the streamer there (behavior of the sidecar itself unchanged).

## Impact

- Repo layout: new `native/cli/`, `native/extensions/`; remove top-level `extensions/`.
- Build: `scripts/build-streamer.sh`, `package.json` scripts, `neutralino.config.json` `resourcesPath`, `Dockerfile` native stage (Go toolchain, streamer + CLI cross-compile, copy CLI into `static/downloads/`).
- Frontend: `InstallAppButton.svelte`, `siteData` download URLs for CLI + desktop.
- Specs: new `cli/*` + `client-downloads`; delta on `native-file-streamer`.
- Out of scope: deleting the external `dropCli` git remote (manual after merge); macOS native/CLI binaries; changing CLI peer protocol.

# Proposal

## Why

The backend, CLI, and desktop host are about 9.5k lines of Go, and a large share is indirection: ports/adapters with one implementation, pass-through wrappers, three components fighting over the terminal, per-file channel maps for a strictly sequential sender. Discovery also found real defects (signaling hub drops a fresh registration when a stale socket closes, sender can hang on a blocked window, transfer stats never reach disk). Rewriting the three layers in Rust as one Cargo workspace lets us delete that complexity, fix the defects, and ship each layer as a single self-contained file (`rust-embed` for the backend's assets) before the frontend layer gets its own change.

## What Changes

**Rewrite (behavior kept unless listed below)**

- Replace all Go code (`cmd/`, `internal/`, `embed.go`, `go.mod`, `go.sum`) with a Cargo workspace: `crates/core`, `crates/backend`, `crates/cli`, `crates/desktop`.
- Backend: one static binary serving the embedded frontend build, the embedded client downloads, `/health`, and the signaling WebSocket `/ws`.
- CLI: one static binary; one event loop owns the terminal for forms, host wait, inbox, and the confirm overlay.
- Desktop: one static binary; still launches a Chromium-family browser in `--app` mode on the remote UI and exposes the loopback bridge and file streamer.
- Wire contracts are unchanged: signaling JSON, peer-to-peer `ctrl`/`files` protocol, desktop bridge (`/bridge`, `/read`, `/write`, `dropPort`/`dropToken`).
- Build: Dockerfile, Makefile, and scripts switch to cargo. Targets and artifact names stay (`Drop-linux_x64`, `Drop-win_x64.exe`, `Drop-cli-linux_x64`, `Drop-cli-win_x64.exe`, backend in a `scratch` image).
- Existing Go tests are ported to Rust; tests for dropped code are not.

**CLI behavior changes**

- **BREAKING** Flags become long-only: `--quick`, `--host`, `--code <pin>`, `--out <dir>`, `--help`. No single-dash flags. Flags may appear before or after positional paths.
- **BREAKING** `--out` applies to the current run only. The download folder is persisted only from `Configurações`; otherwise it defaults to the current directory each run.
- `Configurações` becomes a real third option on the mode menu (display name, download folder, transfer stats with reset, PIX key copy), as the specs already require. The per-launch name/folder step after choosing host or join is removed.
- Transfer stats are persisted to `~/.dropConfig`.
- Inbox search accepts every printable character in the query; action keys act only in browse mode.
- Folder watch waits for a file to stop growing before sending it, and skips dot-prefixed files and directories (same rules as the desktop watcher).
- Copy share link (`C`) is available to the host only.
- A corrupt `~/.dropConfig` is backed up to `~/.dropConfig.bak` before the first write.
- Send chunk size is the negotiated SCTP maximum capped at 256 KiB, so a peer advertising a huge maximum no longer stalls the sender.
- The CLI follows the browser's transfer semantics where Go diverged: a sender stops on an inbound `cancel`, a failed receive sends `cancel`, and chunks that arrive before the writer is ready are kept.

**Desktop behavior changes**

- **BREAKING** No command-line flags. `DROP_URL` is the only setting; window size is fixed at 1024x768. `CHROME_BIN` is gone.
- Browser lookup uses fixed default install paths per OS (Chrome, then Chromium; on Windows also Edge). Not finding one is a fatal error.
- Windows executable uses the GUI subsystem (no console window) and carries an icon and version info.
- Native dialogs go through one cross-platform dialog library instead of per-platform code.
- `fs.readDir` on an empty directory returns `[]`; a watch `add` event always carries `size`.

**Backend behavior changes**

- `FRONTEND_DIR` and `DOWNLOADS_DIR` are removed; only `PORT` remains. Debug builds read assets from disk automatically.
- `GET /downloads/` returns 404 instead of a directory listing; file-server redirects (`/index.html` → `./`, `dir` → `dir/`) are dropped.
- Signaling hub: a stale socket closing no longer removes a newer registration; re-announcing a new peer ID on the same socket no longer leaks the old one; writes to one socket are serialized.

**Renames (no behavior change)**

- Frontend: every `native*`/`goNative*`/`goStreamer*` name becomes `desktop*` (`adapters/native/` → `adapters/desktop/`, `NativeApi` → `DesktopApi`, `isNative` → `isDesktop`, …). `package.json` scripts `native:*` → `desktop:*`; `scripts/native-dev.sh` → `scripts/desktop-dev.sh`.
- Specs: capabilities `native-shell`, `native-file-streamer`, `native-builds` become `desktop-shell`, `desktop-file-streamer`, `desktop-builds`; Go and "native" wording is replaced throughout.

**Removed**

- Dead code: unused text constants, desktop `-dev` flag, macOS code paths, `fswatch`/`fsutil`/`env` wrappers, ports/adapters layers, unused signaling structs, `breakread`.
- Stale spec text: `dropnative`, `native/go.mod`, `native/extensions` sidecar binaries, CLI dependency allow-list and in-house package naming rules.

**Not in this change**

- Frontend rewrite (separate change); only the rename above touches `frontend/`.
- Signaling hardening (PIN range, rate limits, `lan` trust), TURN, new platforms, new specs for behavior that has none today.

## Capabilities

### New Capabilities

- `desktop-shell`: how the desktop UI connects to the local desktop host over loopback, receives its credentials, and how the window lifecycle ends the host. Replaces `native-shell`.
- `desktop-file-streamer`: raw byte streaming between the desktop host and disk for sends and receives. Replaces `native-file-streamer`.
- `desktop-builds`: how the backend, CLI, and desktop build independently from one workspace. Replaces `native-builds`.

### Modified Capabilities

- `native-shell`: retired; all requirements move to `desktop-shell`.
- `native-file-streamer`: retired; all requirements move to `desktop-file-streamer`.
- `native-builds`: retired; its requirement moves to `desktop-builds`.
- `cli/session`: long-only flags, flags after paths, run-scoped `--out`, `Configurações` on the mode menu without the per-launch settings step, search accepts all characters, persisted transfer stats, corrupt-config backup, cancel wording without Go terms.
- `cli/file-transfer`: folder watch settles files and skips dot-prefixed entries; send chunk size capped at 256 KiB.
- `cli/signaling`: signal relaying requirement loses the Go library name.
- `cli/libs`: dependency allow-list and package-naming requirements removed; clipboard and supported-OS requirements reworded without Go terms.
- `cli/donation-reminder`: flag names; reminder and `Configurações` wording now that the entry is always offered.
- `client-downloads`: publishing requirement renamed and stripped of the removed sidecar streamer binaries.
- `file-transfer`: "native" wording becomes "desktop".

## Impact

- **Code removed**: `cmd/`, `internal/`, `embed.go`, `go.mod`, `go.sum`.
- **Code added**: `Cargo.toml`, `Cargo.lock`, `crates/{core,backend,cli,desktop}`, `crates/desktop/assets/icon.ico`.
- **Build and tooling**: `Dockerfile`, `.dockerignore`, `.gitignore`, `Makefile`, `scripts/build-cli.sh`, `scripts/build-desktop.sh`, `scripts/native-dev.sh` (renamed), root and frontend `package.json` scripts, `README.md`. `.gitea/workflows/deploy.yml` is unchanged (same `BUILD_SHA` arg and port).
- **Frontend**: about 29 files under `frontend/src` renamed or re-referenced; comments in `frontend/vite.config.ts`. No logic change.
- **Dependencies**: Go modules out; Rust crates in (`tokio`, `axum`, `rust-embed`, `webrtc`, `tokio-tungstenite`, `rustls`, `ratatui`, `crossterm`, `clap`, `notify`, `rfd`, `serde`).
- **Users**: CLI scripts using `-q -s -c -o` must switch to the long flags. Desktop launchers passing `--url` must use `DROP_URL`. Existing `~/.dropConfig` files and the desktop browser profile (`<config>/Drop/Chrome`) keep working.
- **Specs**: three capabilities retired and re-created under new names; seven modified.

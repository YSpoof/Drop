# Tasks

Conventions for every group: tests go in a sibling `<name>_tests.rs`; no file above 800 lines; run cargo as `nice -n 3 cargo …`; Go code stays untouched until group 10. Design references (D1–D9) point at `design.md`.

## 1. Workspace scaffold

- [x] 1.1 Create root `Cargo.toml` (workspace members `crates/*`, `[workspace.dependencies]` at latest versions, release profile per D1) and the four crates `drop-core`, `drop-backend`, `drop-cli`, `drop-desktop` with stub entry points; verify `nice -n 3 cargo build --workspace` succeeds.
- [x] 1.2 Add `.cargo/config.toml` with the mingw linker and static CRT for `x86_64-pc-windows-gnu`, and add `target/` to `.gitignore` and `.dockerignore`; verify `git status` shows no `target/` files after a build.
- [x] 1.3 Prove the cross toolchain early: in a throwaway `rust:alpine` container with `musl-dev` and `mingw-w64-gcc`, build a stub that depends on `ring` and `winresource` for `x86_64-unknown-linux-musl` and `x86_64-pc-windows-gnu`; verify both builds succeed and `file` reports a static ELF and a PE32+ executable.

## 2. Shared core (`crates/core`)

- [x] 2.1 Implement `signaling.rs`: client and server message enums tagged by `type` with the exact field names, PIN validation (4 ASCII digits), `SHARE_CODE_RANGE = 625`, public-IPv4 check; port `internal/signaling/hub_test.go` and `internal/cli/adapters/signaling/types_test.go` intents into `signaling_tests.rs`; verify `nice -n 3 cargo test -p drop-core`.
- [x] 2.2 Implement `watch.rs` behind the `watch` feature per D6 (recursive, dot-prefixed skip, new directories added, immediate removal, settle at 50 ms x 40); port `internal/desktop/watcher/watcher_test.go`, `internal/cli/services/watcher_test.go`, and `internal/fswatch/source_test.go` intents, plus tests for hidden entries and a still-growing file, into `watch_tests.rs`; verify `nice -n 3 cargo test -p drop-core --features watch`.

## 3. Backend (`crates/backend`)

- [x] 3.1 Implement `assets.rs`: `rust-embed` structs for `frontend/build` and `downloads`, lookup trait, serving rules and cache table from D3 (SPA fallback, 404 for missing dotted paths, 404 for `/downloads/`, Range on downloads, 405 with `Allow`); port `cmd/backend/frontend_test.go` into `assets_tests.rs` against an in-memory asset set and add a test for the `/downloads/` 404; verify `nice -n 3 cargo test -p drop-backend assets`.
- [x] 3.2 Implement `health.rs` with `option_env!("BUILD_SHA")` defaulting to `dev`; port `cmd/backend/health_test.go` into `health_tests.rs`; verify the test passes and `BUILD_SHA=abc nice -n 3 cargo run -p drop-backend` answers `/health` with `"sha":"abc"`.
- [x] 3.3 Implement `hub.rs` per D3 (peer and code maps, per-connection outbox, connection-identity removal, second `peerId` drops the first entry); add `hub_tests.rs` covering the three fixes (stale close keeps the new registration, re-announce frees the old entry, PIN freed on disconnect); verify `nice -n 3 cargo test -p drop-backend hub`.
- [x] 3.4 Implement `main.rs`: `PORT` (default 4321), router, graceful shutdown within 5 s, startup log line; verify by running the binary with a built frontend and checking `/`, `/health`, an `_app/immutable` asset header, and `/missing.js` returning 404 with `curl -i`.
- [x] 3.5 Run the existing Playwright suite against the Rust backend (`PORT=8080`) with Vite on 4321; verify `pnpm --dir frontend exec playwright test` passes, including `tests/connections/code-join.spec.ts`.

## 4. CLI foundation (`crates/cli`)

- [x] 4.1 Spike: a minimal `webrtc` 0.21 peer that pairs with the real frontend through the Rust backend, opens `ctrl` and `files`, and exchanges one text frame and one 256 KiB binary frame each way with Chromium and Firefox; record in the task notes whether mDNS candidates resolve and which max message size each browser reports. Verify by the frames arriving on both sides. If it fails, stop and report before continuing (fallback `str0m`, D5).
- [x] 4.2 Implement `text.rs` (pt-BR catalog, dead constants dropped) and `args.rs` (clap derive, long flags only, flags before or after paths, catalog usage text, path classification into files and directories); port `internal/cli/ui/quick/runner_test.go` flag cases into `args_tests.rs` and add cases for rejected single-dash flags and flags after paths; verify `nice -n 3 cargo test -p drop-cli args`.
- [x] 4.3 Implement `config.rs`: load and atomic save of `~/.dropConfig`, legacy `autoDownload` ignored, download directory resolution order (`--out`, persisted, current directory), stats totals, visit count and 25-run reminder, corrupt-file backup to `~/.dropConfig.bak`; port `internal/cli/state/{store,state,donation}_test.go` intents into `config_tests.rs` and add tests for run-scoped `--out`, unpinned default, stats persistence, and the backup; verify `nice -n 3 cargo test -p drop-cli config`.
- [x] 4.4 Implement `signaling.rs` (connect with 10 s timeout, announce, join-code, signal relay, 15 s ping, pong reply, URL normalization with `DROP_WS_URL`); port `internal/cli/adapters/signaling/client_test.go` into `signaling_tests.rs` against an in-process mock server; verify `nice -n 3 cargo test -p drop-cli signaling`.
- [x] 4.5 Implement `clipboard.rs` (`wl-copy` → `xclip` → `xsel`; `clip.exe`) and `share.rs` (origin from signaling host, `http` for loopback hosts with bracketed IPv6, default `https://drop.lzart.com.br`); port `internal/cli/ui/share_test.go` into `share_tests.rs` and add the IPv6 case; verify `nice -n 3 cargo test -p drop-cli share`.
- [x] 4.6 Add a compile-time guard so the CLI builds only for Linux and Windows; verify `nice -n 3 cargo check -p drop-cli --target x86_64-apple-darwin` fails with the guard message (or record that the target is not installed and the guard is covered by review). — Recorded: `x86_64-apple-darwin` is not installed; the guard in `crates/cli/src/main.rs` is covered by review.

## 5. CLI peer-to-peer and transfers

- [x] 5.1 Implement `protocol.rs` (13 control messages, identity hash `name|size|mtimeMs`); port `internal/webrtc/protocol_test.go` into `protocol_tests.rs` asserting exact JSON field names; verify `nice -n 3 cargo test -p drop-cli protocol`.
- [x] 5.2 Implement `rtc.rs` (STUN config, offer by smaller peer ID, `ctrl` then `files`, candidate queueing, signal envelope, ready on both channels open, chunk size = min(negotiated, 256 KiB) with 64 KiB fallback); port `internal/webrtc/session_test.go` into `rtc_tests.rs` and add the cap case; verify `nice -n 3 cargo test -p drop-cli rtc`.
- [x] 5.3 Implement `transfer/partial.rs` (`<hash>.drop` naming, resume offset, truncate-open, path sanitizing, collision-safe finalize, discard); port `internal/cli/adapters/fs/repository_test.go` into `partial_tests.rs`; verify `nice -n 3 cargo test -p drop-cli partial`.
- [x] 5.4 Implement `transfer/receive.rs` (meta handling, manual/auto pull rules, aligned resume, mandatory `resume` reply, 1 MiB credits, buffered early chunks, `cancel` on size mismatch, keep partials on peer loss); port `internal/cli/services/{download,transfer_manual}_test.go` into `receive_tests.rs`; verify `nice -n 3 cargo test -p drop-cli receive`.
- [x] 5.5 Implement `transfer/send.rs` (queue, wait for pull, resume handshake with 30 s timeout, 8 MiB window per `fileId`, interruptible waits, stop on inbound `cancel`, `download-aborted` requeue, `batch-done`, requeue on peer loss, announce names relative to the watch root's parent); port `internal/cli/services/{transfer_send,transfer_abort,transfer_simulated,announce}_test.go` into `send_tests.rs` and add a test that an inbound `cancel` stops the send; verify `nice -n 3 cargo test -p drop-cli send`.
- [x] 5.6 Implement `transfer/mod.rs` (control dispatch, `download-mode`, `pull`/`pull-batch`, `bye`) and `session.rs` (pair with no timeout, 15 s first-ready timeout, wait-to-reconnect loop, discard partials on cancel or different peer, stats recorded on completion); port `internal/cli/e2e/transfer_test.go` to `crates/cli/tests/transfer.rs` (single file, batch, output directory, chunk sizing); verify `nice -n 3 cargo test -p drop-cli --test transfer`.

## 6. CLI user interface

- [x] 6.1 Implement `ui/mod.rs` (single crossterm event loop, raw mode and alternate screen ownership, 200 ms tick, command channel), `ui/theme.rs`, and `ui/format.rs` (byte formatting safe at 1 TiB and above, width-aware truncation that never cuts escape sequences); add `format_tests.rs`; verify `nice -n 3 cargo test -p drop-cli format`.
- [x] 6.2 Implement `ui/menu.rs` (three options, PIN input with validation) and `ui/settings.rs` (`Configurações`: display name, download folder with validation and clear-to-unset, stats with confirmed reset, PIX copy, return to menu); port `internal/cli/ui/tui/form_test.go` intents into `menu_tests.rs` and `settings_tests.rs`; verify `nice -n 3 cargo test -p drop-cli menu settings`.
- [x] 6.3 Implement `ui/donation.rs` (shown only before the mode menu when due, copy keeps it open, `Fechar` dismisses); verify with a unit test in `donation_tests.rs` that copy does not clear the due state and `Fechar` does.
- [x] 6.4 Implement `ui/confirm.rs` and `ui/host_wait.rs` (PIN, `c`/`C` hints and feedback, reconnect status); port `internal/cli/ui/tui/confirm_test.go` and `internal/cli/ui/quick/hostkeys_test.go` intents into `confirm_tests.rs` and `host_wait_tests.rs`; verify `nice -n 3 cargo test -p drop-cli confirm host_wait`.
- [x] 6.5 Implement `ui/inbox/{mod,tree,view}.rs` (header with LAN badge, folder tree, selection, pull and dismiss, height budget, scroll window, empty states, transfer rows, host-only `C`); port `internal/cli/ui/tui/inbox_{tree,dashboard,confirm,copy}_test.go` into the matching `*_tests.rs`; verify `nice -n 3 cargo test -p drop-cli inbox`.
- [x] 6.6 Implement `ui/inbox/search.rs` (query takes every printable character, arrows move, Enter focuses, Esc cancels, deep results with path hint); add `search_tests.rs` including typing `readme x` without triggering an action; verify `nice -n 3 cargo test -p drop-cli search`.
- [x] 6.7 Implement `ui/quick.rs` (line output with `\r\n` under raw mode, host keys on a TTY, overlay on Ctrl+C, immediate cancel off a TTY) and wire `main.rs` (mode selection, exit code 0 on confirmed cancel, `erro: …` and exit 1 otherwise); port `internal/cli/ui/quick/crlf_test.go` and `cmd/cli/main_test.go` intents; verify `nice -n 3 cargo test -p drop-cli quick` and `nice -n 3 cargo test -p drop-cli main`.
- [x] 6.8 Manual check against the real frontend through the Rust backend: `dropcli --host` with the browser joining, `dropcli --code <pin>` joining a browser host, send a file and a folder each way, pull and dismiss from the inbox, drop the peer mid-download and confirm auto-resume, quick mode `dropcli --quick --host ./file`; verify each transfer completes with identical checksums and record the results in the task notes.

## 7. Desktop host (`crates/desktop`)

- [x] 7.1 Implement `browser.rs` (fixed lookup paths per OS including Edge on Windows, launch flags, profile directory `<config dir>/Drop/Chrome` with mode 0700, fixed 1024x768); port `internal/desktop/chrome/chrome_test.go` into `browser_tests.rs` and add lookup-order tests against a temp tree; verify `nice -n 3 cargo test -p drop-desktop browser`.
- [x] 7.2 Implement `server.rs` (token generation, single auth check, CORS with private-network header, `OPTIONS` 204) and `streamer.rs` (`/read` with Range, `/write` truncate and append); port `internal/desktop/streamer/streamer_test.go` into `streamer_tests.rs`, including the zero-length file with `Range: bytes=0-` case; verify `nice -n 3 cargo test -p drop-desktop streamer`.
- [x] 7.3 Implement `fs.rs` and `bridge.rs` (ten methods, one task per request, `fs.readDir` returning `[]` when empty, `watch.event` pushes with `size` always present); port `internal/desktop/bridge/bridge_test.go` into `bridge_tests.rs` and add the empty-directory and zero-byte `add` cases; verify `nice -n 3 cargo test -p drop-desktop bridge`.
- [x] 7.4 Implement `dialog.rs` with `rfd` (multi-file and folder pickers, default titles, cancel returns `[]` or `""`); port `internal/desktop/dialog/dialog_test.go` intents into `dialog_tests.rs`; verify `nice -n 3 cargo test -p drop-desktop dialog`.
- [x] 7.5 Verify dialogs on the static musl build on a Linux desktop: both pickers open and return paths. If they do not, add the `zenity` → `kdialog` shell-out fallback from D6 with a test using a fake script, and verify again.
- [x] 7.6 Implement `main.rs` (`DROP_URL` only, no flags, GUI subsystem on Windows, fatal errors in a message dialog on Windows and on stderr elsewhere, exit when the browser exits, 3 s server shutdown) and `build.rs` with `winresource`; generate `crates/desktop/assets/icon.ico` from `frontend/static/images/pwa/512.png` and commit it; verify the Windows build shows the icon and version in file properties and opens no console window.
- [x] 7.7 Manual check: run the desktop host with `DROP_URL=http://localhost:4321` against Vite and the Rust backend; verify the UI selects desktop providers, a folder watch reports a new file, a file sends and a receive lands in the chosen folder, a resumed receive appends, and closing the window ends the process.

## 8. Build and tooling

- [x] 8.1 Rewrite `Dockerfile` per D7 (`rust:alpine`, `cargo-chef`, client stage for both targets, frontend stage, backend stage embedding the frontend build and the four client binaries, `scratch` final); verify `docker build --build-arg BUILD_SHA=test -t drop:test .` succeeds, the image holds only `/backend`, and a running container serves `/health` with `"sha":"test"` plus all four `/downloads/` files with non-zero length.
- [x] 8.2 Update `Makefile` (`build`, `dev` with the backend on `PORT=8080`, `test`, `clean` including `target/`); verify `make build` produces the backend, `make dev` starts both servers without a port clash, and `make test` runs cargo tests then Playwright.
- [x] 8.3 Update `scripts/build-cli.sh` and `scripts/build-desktop.sh` to cargo with unchanged output names, rename `scripts/native-dev.sh` to `scripts/desktop-dev.sh` using `DROP_URL`, and rename `native:*` scripts to `desktop:*` in the root and `frontend/package.json`; verify each script runs and `pnpm desktop:dev` starts the backend, Vite, and the desktop host.
- [x] 8.4 Rebuild the image after touching only a frontend file; verify the client build stage is served from cache and the four `/downloads/` files are still present.

## 9. Frontend rename

- [x] 9.1 Apply the rename map from D8 across `frontend/src` (directory, files, identifiers, the "Go native host" error text) and the Go comments in `frontend/vite.config.ts`; verify `grep -rnE "goNative|goStreamer|[nN]ative" frontend/src` returns only intentional non-desktop uses (none expected) and `pnpm --dir frontend run check` and `pnpm --dir frontend run build` succeed.
- [x] 9.2 Run the Playwright suite after the rename; verify it passes.

## 10. Cutover

- [x] 10.1 Delete `cmd/`, `internal/`, `embed.go`, `go.mod`, `go.sum`, and stale ignore entries for Go and Neutralino; verify `git ls-files '*.go' go.mod go.sum` prints nothing and `grep -rnI "golang\|go build\|go run\|go test" --exclude-dir=openspec --exclude-dir=node_modules --exclude-dir=target .` finds nothing.
- [x] 10.2 Update `README.md` in pt-BR: technology list (Rust, no Neutralino), development section (`make` targets now driving cargo), CLI flags (`--quick`, `--host`, `--code`, `--out`), desktop `DROP_URL`; verify every command shown runs as written.
- [x] 10.3 Edit the Purpose text of `openspec/specs/cli/libs/spec.md` so it no longer describes Go module layout or in-house package naming; verify `openspec validate --specs --strict` reports no new issue for that spec.
- [x] 10.4 Full verification: `nice -n 3 cargo test --workspace`, `make test`, the Docker build from 8.1, and the manual checks 6.8 and 7.7 repeated on the final tree for Linux; on Windows, run `Drop-cli-win_x64.exe --help` and one host/join transfer, and launch `Drop-win_x64.exe`. Verify all pass and record results.
- [x] 10.5 Run `openspec validate rust-rewrite --strict`; verify it reports the change as valid.

## Workflow follow-up

- Archive the change after review; `.openspec.yaml` carries `retire_capabilities: true` so `native-shell`, `native-file-streamer`, and `native-builds` are deleted when their last requirement is removed.
- After archive, confirm `openspec/specs/` contains `desktop-shell`, `desktop-file-streamer`, `desktop-builds` and no `native-*` directory.
- Open the separate change for the frontend layer.

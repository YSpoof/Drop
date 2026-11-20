# Design

## Context

See proposal.md for motivation. Facts that shape the approach:

- Go today: `cmd/{backend,cli,desktop}` + `internal/*`, about 9.5k source lines and 5k test lines. Built with `CGO_ENABLED=0` for linux/amd64 and windows/amd64; backend ships alone in a `scratch` image.
- The frontend (SvelteKit, `adapter-static`, output `frontend/build`) is not rewritten here. It pins three wire contracts:
  1. Signaling WebSocket `GET /ws`: JSON frames `announce`, `join-code`, `signal`, `ping` in; `code-assigned`, `peer-joining`, `join-accepted`, `join-rejected`, `signal`, `pong` out.
  2. Peer-to-peer protocol: data channels `ctrl` (JSON text) and `files` (raw bytes), signal payloads in the FastRTC envelope, the peer with the smaller peer ID offers.
  3. Desktop bridge: `ws://127.0.0.1:<port>/bridge?token=`, `GET /read`, `POST /write`, credentials passed as `?dropPort=&dropToken=`.
- Only the backend has assets to embed (frontend build and the four client binaries). The desktop host loads the remote UI; the CLI has no assets.
- The deploy workflow only runs `docker build --build-arg BUILD_SHA=…` and expects port 4321, so it needs no change.
- Decisions below marked **(user)** were chosen by the user during proposal clarification.

## Goals / Non-Goals

**Goals:**

- Three static single-file executables from one Cargo workspace, with less code than the Go version.
- Unchanged wire contracts; the frontend needs no logic change.
- Fix the defects found in discovery while porting, not after.
- No source file above 800 lines; tests live in a sibling `<name>_tests.rs`.

**Non-Goals:**

- Frontend logic changes, the dead `frontend/src/lib/server/signaling/handler.ts`, and its `ws` dependencies.
- Signaling hardening: PIN range stays `0000`–`0624`, no rate limit, `lan` still trusts the client-reported `publicIpv4`.
- TURN, new platforms (macOS, arm64), single-instance handling for the desktop host.
- New specs for behavior that has none today (backend HTTP, signaling hub, desktop internals) **(user)**. Those rules are recorded here instead.
- Rust lint/format git hooks and a pinned toolchain file **(user)**.

## Decisions

### D1. Workspace layout **(user)**

```
Cargo.toml              workspace, [workspace.dependencies], release profile
crates/core             drop-core     lib: signaling types, settle watcher
crates/backend          drop-backend  bin
crates/cli              drop-cli      bin
crates/desktop          drop-desktop  bin
```

- Edition 2024, latest stable toolchain, latest crate versions at implementation time.
- Release profile: `strip = true`, `lto = true`, `codegen-units = 1`, `panic = "abort"`.
- `drop-core` has two modules. `signaling` is always on (serde only). `watch` sits behind a `watch` feature so the backend does not compile `notify`.
- Alternative considered: one crate with three `src/bin`. Rejected: every binary would compile every dependency, and private code could leak across applications.

### D2. Runtime and shared libraries

- `tokio` everywhere. `axum` for both HTTP servers (backend and desktop loopback). `serde`/`serde_json` for every wire type. No logging framework; plain `eprintln!`.
- TLS only where the CLI dials out: `tokio-tungstenite` with `rustls` and `webpki-roots`, because static binaries have no system CA store to rely on.
- Alternative considered: `hyper` directly. Rejected: axum gives routing, WebSocket upgrade, and extractors for the same binary size class.

### D3. Backend

Modules: `main.rs` (env, router, shutdown), `assets.rs` (embedded files and serving rules), `health.rs`, `hub.rs` (signaling).

**Assets.** Two `rust-embed` structs: `frontend/build` and `downloads`. Release builds embed; debug builds read from disk, which replaces `FRONTEND_DIR` and `DOWNLOADS_DIR` **(user)**. The serving rules take an asset-lookup trait so tests use an in-memory set. As with the Go embed today, both folders must exist when the backend compiles.

Serving rules for `GET`/`HEAD` (other methods: 405 with `Allow`):

| Request | Response |
|---|---|
| `/health` | 200 `{"ok":true,"sha":"<sha>"}`, `application/json; charset=utf-8`, `no-store`, `nosniff` |
| `/ws` | WebSocket upgrade, any origin |
| `/downloads/<file>` | file with Range support; missing file or bare `/downloads/` → 404 **(user)** |
| `/` or path with no `.` in the last segment and no matching file | SPA shell (`index.html`), `no-cache`, `nosniff` |
| existing file | file, `nosniff`, cache header from the table below |
| `dir/` holding `index.html` | that file, `no-cache` |
| missing path whose last segment contains `.` | 404, `text/plain`, `no-store` |

Cache table: `_app/immutable/*` → `public, max-age=31536000, immutable`; `index.html`, `service-worker.js`, `*/index.html` → `no-cache`; everything else → no `Cache-Control`. Content types come from `mime_guess`. Go's file-server redirects are dropped. The shell is looked up per request, so a debug build without a frontend build still starts and serves `/ws`.

`sha` comes from `option_env!("BUILD_SHA")`, default `dev`. `PORT` defaults to 4321. SIGINT/SIGTERM trigger graceful shutdown with a 5 second limit.

**Hub.** One `Mutex` around two maps: `peers: peerId → Peer { conn, name, code, public_ipv4 }` and `codes: pin → peerId`. Each connection gets an id and an `mpsc` outbox drained by its own writer task, so writes to one socket are serialized. Message handling ports the Go rules one to one (PIN choice order, 50 retries, silent drops, `lan` flag). Three fixes:

- Removing a peer checks `conn` identity, so a stale socket closing cannot delete a newer registration.
- A connection that announces a second `peerId` drops its first entry.
- No concurrent writers on one socket.

### D4. CLI

Modules, each well under 800 lines:

```
main.rs        args → mode, exit code
args.rs        clap derive, pt-BR usage
text.rs        pt-BR catalog
config.rs      ~/.dropConfig: settings, stats, donation counters
signaling.rs   WebSocket client, heartbeat
rtc.rs         peer connection, ctrl/files channels, ready
protocol.rs    control message enum
transfer/      mod.rs (dispatch), send.rs, receive.rs, partial.rs (.drop files, sanitize, finalize)
session.rs     pair → ready → run → wait-to-reconnect loop
clipboard.rs   wl-copy → xclip → xsel; clip.exe
share.rs       share link
ui/            mod.rs (terminal owner), menu.rs, settings.rs, donation.rs,
               host_wait.rs, inbox/{mod,tree,search,view}.rs, confirm.rs,
               theme.rs, format.rs, quick.rs
```

**One terminal owner.** A single task reads `crossterm`'s event stream and owns raw mode and the alternate screen for the whole process. This removes `breakread`, the CRLF shim, the SIGINT handoff atomics, and the 500 ms restore barrier.

- Interactive mode is one `ratatui` app from first screen to exit: donation reminder → mode menu (`Gerar um código`, `Possuo um código`, `Configurações`) → PIN input → host wait → inbox → confirm overlay. Forms are small hand-built widgets **(user)**. Send and watch status goes to the inbox status line, never to stdout while the alternate screen is up.
- Quick mode prints lines. On a TTY it still enables raw mode to read `c`, `C`, and Ctrl+C, so its line writer emits `\r\n`. The confirm overlay briefly enters the alternate screen. Off a TTY there is no raw mode and SIGINT ends the run at once.
- Alternative considered: `inquire` or `cliclack` for forms. Rejected: a second terminal owner brings the handoff problems back.

**State.** One `Arc<Mutex<SessionState>>` (peer, pending offers, transfers) written by the session tasks and read by the UI on a 200 ms tick or a redraw notification. The UI sends commands (pull, dismiss, copy, quit) over an `mpsc` channel. The ports/adapters layers, getter/setter state bags, and single-implementation interfaces are not ported.

**Arguments.** `clap` derive with long flags only: `--quick`, `--host`, `--code <pin>`, `--out <dir>`, `--help` **(user)**. Short flags are not declared, so they are rejected. Usage text comes from the pt-BR catalog. Binary help name stays `dropcli`.

**Config.** `~/.dropConfig` keeps its JSON shape (`deviceName`, `downloadDir`, `transferStats`, `visitCount`, `donationReminderAnchor`), written atomically through a temp file. Changes:

- `downloadDir` is written only from `Configurações`; `--out` never touches it **(user)**. A value already pinned by the Go CLI cannot be told apart from a chosen one, so it is honored until the user clears it in `Configurações`.
- Transfer stats are added on each completed transfer and saved **(user)**.
- A file that fails to parse is copied to `~/.dropConfig.bak` before the first write **(user)**.

**Signaling client.** Same messages and timing as Go: 10 s connect timeout, `ping` every 15 s, answers server `ping` with `pong`. The unused pong-wait code is not ported. Default URL `wss://drop.lzart.com.br/ws`, override `DROP_WS_URL`, same normalization. Go honored `HTTP(S)_PROXY` for this socket; `tokio-tungstenite` does not, and it is not re-implemented (see Risks).

**Clipboard** stays a shell-out helper. A clipboard crate would lose the X11 selection when the process exits.

**Folder watch** uses `drop_core::watch` (D6) and so settles files and skips dot-prefixed entries **(user)**.

### D5. Peer-to-peer in the CLI

`webrtc` 0.21 (webrtc-rs) on its tokio runtime with the `ring` provider **(user)**. It is a pure-Rust pion-style API, includes mDNS, and needs only a C compiler for `ring`, which both cross targets have.

- Config: one STUN server `stun:stun.l.google.com:19302`, no TURN. Channels `ctrl` then `files`, ordered and reliable, created by the peer whose ID is the smaller string. Trickle ICE; candidates that arrive before the remote description are queued.
- Signal payloads use the envelope `{type:"description",description}` / `{type:"candidate",candidate}` with browser-shaped JSON.
- `protocol.rs` is one serde enum tagged by `type` for the 13 control messages. `files` frames are raw bytes with no header.
- Sender: `meta`, wait for `pull` when the peer is manual, `start`, wait up to 30 s for `resume`, stream within an 8 MiB credit window, `done`, wait up to 15 s for `ack`. One async task per file, sequential; no per-file channel maps.
- Receiver: aligns the resume offset down to `chunkSize`, always answers `start` with `resume`, credits every 1 MiB, finalizes with collision-safe names and path sanitizing.
- Chunk size is `min(negotiated max message size, 256 KiB)`, fallback 64 KiB.

Where Go diverged from the browser, the browser is the reference **(user)**:

| Go behavior | Rust behavior |
|---|---|
| Sender ignores inbound `cancel` | Sender stops that file and moves on |
| Size mismatch after `done` sends nothing | Receiver sends `cancel` |
| Chunk without a writer is dropped after 1 s | Chunks are buffered until `start` is handled |
| Window wait cannot be interrupted | Wait ends on cancel, abort, or peer loss |
| Credits ignore `fileId` | Credits apply to the matching file only |

Alternatives considered: `str0m` (we would write the socket and ICE driving loop ourselves) and `datachannel` (C++ toolchain, hurts static musl and Windows cross builds).

### D6. Desktop host

Modules: `main.rs`, `browser.rs`, `server.rs` (router, auth, CORS), `bridge.rs`, `fs.rs`, `streamer.rs`, `dialog.rs`, `build.rs`.

**Startup.** Generate a 32-byte hex token, bind `127.0.0.1:0`, start the server, launch the browser on `<DROP_URL or https://drop.lzart.com.br>?dropPort=&dropToken=`, wait for the browser to exit, shut the server down within 3 s. No command-line flags; window size 1024x768 **(user)**.

**Browser lookup** **(user)**: first existing path wins, none is a fatal error.

- Linux: `/usr/bin/google-chrome`, `/usr/bin/google-chrome-stable`, `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/local/bin/google-chrome`, `/usr/local/bin/chromium`, `/snap/bin/chromium`.
- Windows: `%ProgramFiles%`, `%ProgramFiles(x86)%`, `%LocalAppData%` each with `\Google\Chrome\Application\chrome.exe`, then with `\Chromium\Application\chrome.exe`, then Edge at `%ProgramFiles(x86)%` and `%ProgramFiles%` with `\Microsoft\Edge\Application\msedge.exe`.

Launch flags and the profile directory `<config dir>/Drop/Chrome` are unchanged, so stored browser data survives the switch. The macOS branch is not ported.

**Windows executable** **(user)**: GUI subsystem, so no console window. Because stderr is then invisible, a fatal startup error is shown in a message dialog. `build.rs` embeds `assets/icon.ico` and version info with `winresource` when the target is Windows. The icon is generated once from `frontend/static/images/pwa/512.png` and committed.

**Server.** One auth check for all three routes: `X-Drop-Token` header or `token` query, constant-time compare, 401 otherwise. CORS headers as today, including `Access-Control-Allow-Private-Network: true`; `OPTIONS` answers 204 before auth.

- `/bridge`: JSON-RPC frames `{id, method, params}` → `{id, result | error}`, push `{event, data}`. Same ten methods. Each request runs as its own task, so an open dialog no longer blocks other calls. `fs.readDir` returns `[]` for an empty directory.
- `/read`: file with Range support. `/write`: truncate, or append with `append=1`.
- Watch: `drop_core::watch` emits `add` (always with `size`) and `unlink`, pushed as `watch.event`.

**Shared watcher** (`drop_core::watch`): recursive `notify` watcher that skips dot-prefixed names, adds new directories as they appear, emits removals immediately, and emits an addition once the size is stable (poll every 50 ms, two equal readings, at most 40 polls). The desktop uses both event kinds; the CLI uses additions.

**Dialogs.** `rfd` **(user)**: Win32 dialogs on Windows, XDG desktop portal on Linux. Its portal backend loads `libdbus` at runtime, which a static musl binary may not be able to do; `rfd` then falls back to the `zenity` program. A task verifies this on the static build. If neither path yields a dialog, Linux keeps a small shell-out to `zenity` then `kdialog`, as Go does today.

### D7. Build and tooling

- `Dockerfile`: `rust:alpine` builder **(user)** with `musl-dev` and `mingw-w64-gcc`; `cargo-chef` for dependency layer caching. Stages: clients (CLI and desktop for `x86_64-unknown-linux-musl` and `x86_64-pc-windows-gnu`) → frontend → backend (embeds the frontend build and the four renamed client binaries, `BUILD_SHA` arg) → `scratch` with `/backend`, `PORT=4321`.
- `.cargo/config.toml` sets the mingw linker and static CRT for the Windows target.
- `Makefile` is the single entry point **(user)**: `build` (CLI, desktop, then backend), `build-backend`, `build-cli`, `build-desktop` (cargo, unchanged output names), `dev` (backend on `PORT=8080`, fixing today's collision with Vite on 4321), `dev-desktop` (backend, Vite, and the desktop host with `DROP_URL`), `preview-desktop`, `test` (`cargo test --workspace`, then Playwright against a backend on 8080), `clean`. The former `scripts/build-*.sh` and `scripts/native-dev.sh` and the `package.json` `cli:build`/`native:*` scripts are folded into it.
- `.gitignore` and `.dockerignore` gain `target/` and lose stale entries.

### D8. Frontend rename **(user)**

Mechanical, no logic change, verified by the frontend type check and build:

- `frontend/src/lib/adapters/native/` → `adapters/desktop/`; files `goNative{Api,Client,Picker,Watch}.ts` → `desktop{Api,Client,Picker,Watch}.ts`, `goStreamerClient.ts` → `desktopStreamerClient.ts`, `native<X>.ts` → `desktop<X>.ts`; `ports/nativeApi.ts` → `ports/desktopApi.ts`.
- Identifiers: `Native*` → `Desktop*`, `native*` → `desktop*`, `isNative` → `isDesktop`, `hasNativeFs` → `hasDesktopFs`, `startGoNative` → `startDesktop`, `GoNativePicker` → `DesktopPicker`.
- Not renamed: the `@typescript/native` package alias and `--tsgo` (TypeScript compiler), wire names `dropPort`/`dropToken`.
- `package.json` scripts `native:*` → `desktop:*` at the root and in `frontend/`.

### D9. Tests **(user: port existing tests only)**

Each Go test's intent is re-expressed in Rust next to the code it covers; tests of dropped code are not ported.

| Go tests | Rust home |
|---|---|
| `cmd/backend/*_test.go`, `internal/signaling/hub_test.go` | `crates/backend/src/{assets,health,hub}_tests.rs` |
| `internal/cli/state/*`, `adapters/fs`, `adapters/signaling` | `crates/cli/src/{config,signaling}_tests.rs`, `transfer/partial_tests.rs`, `crates/core/src/signaling_tests.rs` |
| `internal/cli/services/*`, `internal/webrtc/*` | `crates/cli/src/{protocol,rtc}_tests.rs`, `transfer/{send,receive}_tests.rs` |
| `internal/cli/e2e/transfer_test.go` | `crates/cli/tests/transfer.rs` (two in-process sessions) |
| `internal/cli/ui/**` | `crates/cli/src/{args,share}_tests.rs`, `ui/**/*_tests.rs` |
| `internal/desktop/**`, `internal/fswatch` | `crates/desktop/src/{bridge,streamer,browser,dialog}_tests.rs`, `crates/core/src/watch_tests.rs` |

Tests are added for behavior this change introduces (long flags, run-scoped `--out`, stats persistence, config backup, search input, settle, hub stale-close, chunk cap). Playwright stays the browser-level check.

## Risks / Trade-offs

- [`webrtc` 0.21 is pre-1.0 and its interop with Chrome and Firefox for this protocol is unproven here: mDNS host candidates, accepted message size, back-pressure] → The first CLI task is a spike that pairs a minimal Rust peer with the real frontend and sends a file both ways before the transfer layer is written. If it fails, switch to `str0m` behind the same `rtc.rs` surface; nothing else depends on the crate.
- [`rfd` on a static musl binary may not reach the portal] → Verified by a task; documented fallback to `zenity`/`kdialog`.
- [`ring` and `winresource` under mingw cross compilation] → Exercised by the first Docker build task, before feature work depends on it.
- [Hand-built forms look different from huh] → Accepted; titles, texts, and key behavior are kept.
- [`HTTP(S)_PROXY` no longer applies to the CLI signaling socket] → Accepted regression; WebRTC traffic never used the proxy, so such networks rarely completed a transfer anyway.
- [A `downloadDir` pinned by the old CLI keeps overriding the current directory] → The user clears it once in `Configurações`.
- [Long-only flags break existing scripts] → Marked BREAKING; `--help` lists the new flags and old flags fail loudly with usage.
- [Desktop users whose browser is outside the default paths lose `CHROME_BIN`] → Accepted by the user; the error dialog names the paths searched.
- [Everything lands in one change] → Go is deleted only in the last task group, after the Rust binaries pass their tests and the manual checks, so each earlier group can be compared against the running Go version.
- [Unpinned `rust:alpine` can change under us] → Accepted by the user; `Cargo.lock` still pins crates.

## Migration Plan

1. Build the Rust workspace beside the Go code: core → backend → CLI → desktop.
2. Switch Dockerfile, Makefile, and scripts to cargo; build the image locally and run it.
3. Rename frontend identifiers; update README.
4. Delete the Go code and Go-only files.
5. Deploy through the existing workflow by merging to `main`.

Rollback: images are tagged by commit SHA, so `docker service update --image …:<previous sha>` restores the Go backend and the Go client downloads it embeds. The source rollback is a revert of the merge. `~/.dropConfig` stays readable by the Go CLI because its shape is unchanged.

## Open Questions

- Whether `rust-embed`'s `allow_missing` attribute is worth enabling so a fresh clone compiles the backend without a frontend build. It does not affect behavior or tasks.

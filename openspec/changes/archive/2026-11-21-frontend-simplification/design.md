# Design

## Context

See proposal.md for motivation. Facts from investigation that shape the approach:

- Frontend: SvelteKit 3 with `adapter-static` and `ssr=false`, Svelte 5 runes only (no `svelte/store`), Tailwind 4 and daisyUI 5, about 9k lines under `frontend/src`. The Rust backend embeds `frontend/build`. Vite dev proxies `/ws` to the backend on 8080.
- The transfer engine (`src/lib/utils/webrtc/`) is about 1,500 lines:
  - `session.ts` holds `SenderState`, `ReceiverState` and `TransferSession`;
  - `sender.ts`, `receiver.ts` and `transfer.ts` (`TransferManager`) reach into that shared state;
  - `TransferCallbacks` (11 hooks) has one implementation, in `services/transferService.ts`.
- Connections come from fastrtc (`peerSession.ts`), which opens the `ctrl` and `files` channels, applies send backpressure, and exposes `maxMessageSize` uncapped.
- The Rust CLI already implements the same protocol as two sequential tasks: `crates/cli/src/transfer/send.rs` (one file at a time, with 30 s and 15 s timeouts) and `receive.rs` (an inbox, with a single active receive).
- Platform layer:
  - nine ports in `src/lib/ports/`, web and desktop adapters, wired by quick-di in `hooks.client.ts`;
  - `inject()` creates singletons, and `configure()` maps abstract-class tokens;
  - with no desktop credentials, `startDesktop` throws immediately, so web users get web providers without waiting.
- LAN detection depends on the browser's own public IPv4. The backend sits behind Cloudflare Tunnel and its host has no IPv6, so it cannot see the client's IPv4 itself. The frontend fetches its IPv4 (ipify through `desfetch`) and sends it as `publicIpv4` in `announce`, and the backend validates it (`is_public_ipv4`) before comparing peers. That flow stays as it is.
- Tests: Playwright only (`tests/files.spec.ts`, `tests/drag-drop.spec.ts`, `tests/connections/code-join.spec.ts`), with no unit test runner. The connection specs need the backend on 8080, which Playwright does not start.
- The user's code style applies to the new code:
  - `Promise.withResolvers` instead of `new Promise`;
  - no nested ternaries (use `switch`);
  - no file above 800 lines.

## Goals / Non-Goals

**Goals:**

- The browser engine mirrors the Rust engine's structure: one sender loop, one receiver with a single current file, explicit timeouts. A reader can map one onto the other.
- The engine can be unit-tested without WebRTC, stores or a DOM.
- Every high-confidence bug from investigation is covered by a test that fails before its fix and passes after.
- Roughly 9k → 7k lines in `frontend/src`, with no feature removed.

**Non-Goals:**

- Removing quick-di, or replacing the ports with a single platform module **(user)**.
- Visual redesign. Components keep their markup and style except where a bug fix or a deduplication requires otherwise.
- Changing the signaling JSON, the desktop bridge methods, or the streamer endpoints.
- Supporting peers on the old protocol **(user: app not public)**.
- Multi-peer sessions beyond what works today.

## Decisions

### D1. Stream ID header on `files` frames (breaking)

`start` gains a `streamId` field: a u32 taken from a per-connection counter that the sender increments on every `start`. Each `files` frame is `[streamId: u32 BE][file bytes]`. The receiver keeps `current = { fileId, streamId, resumed }` and writes a frame only when the IDs match and `resumed` is true; anything else is dropped.

- Why sender-assigned in `start` and not receiver-assigned in `resume`: the receiver learns the ID before any byte can arrive, the sender needs no extra round trip, and `resume` keeps its shape.
- Alternatives considered:
  - One data channel per file: costs a channel open per file, and fastrtc expects fixed labels.
  - A per-file sequence number: the receiver would still have to map numbers to files, for the same header cost.
  - The file ID string in each frame: a variable-length header, and string decoding on the hot path.
- Credits, offsets and the 8 MiB window count file bytes only. A whole frame must fit the negotiated SCTP maximum, because `RTCDataChannel.send` and webrtc-rs reject larger messages. So the chunk size is `min(maxMessageSize, 256 KiB) − 4` (64 KiB − 4 when unknown), and that is the value `start.chunkSize` advertises. The Rust CLI integration tests found this: a 256 KiB + 4 frame was rejected.
- The Rust CLI changes in the same change (`protocol.rs` `Start { stream_id }`, a frame header in `send.rs`, filtering in `receive.rs`). No protocol version field **(user)**.

### D2. Browser sender as one sequential loop

The sender becomes one async loop per connection:
- take the next file: pulled files first, or auto-mode files in announce order;
- `meta` if not announced yet;
- `start` with a new `streamId`;
- await `resume` (30 s) with an `AbortSignal`;
- stream within the 8 MiB window;
- `done`;
- await `ack` (15 s);
- `batch-done` when the queue drains after at least one file.

- Inputs reach the loop through one small inbox (`resume`, `credit`, `ack`, `cancel`, `download-aborted`, `pull`, `pull-batch`, `download-mode`). Each wait uses `Promise.withResolvers` and is keyed by `fileId` and the current `streamId`. An answer for an earlier start never resolves a later wait (spec: each start waits for its own resume).
- One `AbortController` per file is the only stop source. Cancel, `download-aborted`, peer loss and read failure all abort it. The loop catches, reports the file (failed, cancelled, or reset to pending), and continues. This replaces the five tracking sets and the six stop checks.
- A read error inside the loop sends `cancel` and marks the file failed (spec: read failure cancels only that file).
- Alternatives considered: patching the current classes. Rejected because the stall, stale-resume and ack bugs all come from state shared across the classes. Fixing them in place would add more flags.

### D3. Browser receiver keyed by the current file

The receiver keeps `offers: Map<fileId, Offer>` (from `meta`) and at most one `current` receive (`{ fileId, streamId, writer, written, credited }`).
- `start` replaces `current`, aligns the resume offset down to the chunk size, and opens the writer.
- The receiver always answers `start` with `resume`, and answers an unknown or dismissed `fileId` with `download-aborted`.
- Credits go out every 1 MiB of accepted bytes.
- After `done` the receiver checks the size, then closes and sends `ack`, or sends `cancel` and discards.
- The write queue is one promise chain with a `.catch` on every link, so a failed write ends the current file, not every later write.
- Peer loss or abort first takes a snapshot of the open writer and zip, then resets state, then closes the snapshot. This fixes the leaked streams.
- `pull-batch` opens one zip per batch and finalizes it when the batch's last file finishes, whatever the batch size.

### D4. Engine boundary and module layout

The engine lives in `src/lib/transfer/`:

| File | Contents |
|---|---|
| `protocol.ts` | message types, encode/decode, frame header |
| `send.ts` | sender loop |
| `receive.ts` | receiver |
| `engine.ts` | wiring and control dispatch |

It talks to the outside through two plain interfaces:
- `Link`: `sendControl(msg)`, `sendFrame(bytes)`, `chunkSize`, `closed: AbortSignal`;
- `Hooks`: progress, status, and batch events.

`peerSession.ts` builds the `Link` from the fastrtc channels. `transferService.ts` implements `Hooks` as store updates. `TransferCallbacks`, `TransferSession` and `TransferManager` go away. The engine imports neither fastrtc nor stores, so Vitest runs it against a paired in-memory `Link`.

- Alternative: keep the engine under `utils/webrtc/`. Rejected because it is not a utility, and the move makes the old and new code easy to tell apart during review.

### D5. Platform layer trim (quick-di kept)

- Delete `ports/desktopApi.ts` (one implementation, desktop-only consumers). The desktop adapters import the typed RPC helpers from `adapters/desktop/desktopApi.ts` directly.
- Delete `ports/clipboard.ts` and both adapters. Callers use one `copyText()` helper over `navigator.clipboard.writeText`.
- Merge `EnvironmentPort.hasDesktopFs` into `isDesktop`. Move `FileReaderPort.desktopPath` into a plain `filePath(file)` helper.
- Delete `adapters/desktop/desktopWatch.ts` (dead) and the duplicated `StatResult`/`DirEntry` types in `desktopPicker.ts`.
- Keep Picker, Watcher, ReceiveFolder, FileReader and Notifications as ports with no-op web implementations. They are the desktop capabilities, and quick-di stays **(user)**.

Bug fixes in this layer:
- **Streamer reads:** every read is its own bounded `Range` request, with no shared reader, so two reads of one path can no longer share or cancel each other. That costs one loopback request per chunk, which is cheap, and removes the reader bookkeeping.
- **Service-worker readiness:** `ensureReady` races `navigator.serviceWorker.ready` against a 4 s timeout. Without a worker, files are collected in a Blob and saved on completion, up to 512 MiB per file **(user)**. A larger file is refused with `download-aborted` and a toast. There is no streaming path without a service worker, so this is the only fallback.
- **Service-worker backpressure:** chunks are posted to the worker with transfer lists, and the page waits for the worker's per-chunk acknowledgement once more than 4 MiB is queued.
- **Bridge connect:** on timeout, close the pending socket itself, and set the session only on success. `callRpc` gets a timeout.
- **Desktop finalize:** the host's `fs.move` never replaces an existing file. It hard-links then unlinks, which is atomic on one filesystem, and falls back to an exclusive-create copy. An existing target fails with `target exists`, and the frontend then tries the next free name. Concurrent finalizes in one page also reserve their candidate name. This is a host-side change (`crates/desktop/src/fs.rs`); the method name and parameters stay the same.

### D6. UI fixes and deduplication

- **Announce effect:** wrap `session.announce()` in `untrack` so a display-name keystroke does not re-announce.
- **Shared UI pieces:**
  - one `DevicePrefsFields.svelte` used by `SetupWizard` and `SettingsModal`, with auto-download persisted by a single `transferStore` setter;
  - one `PixKeyButton.svelte`;
  - one `createCopied()` helper that clears its own timer;
  - one exported `CodeJoinPhase` type;
  - one `pendingReceived` derived value in `transferStore`.
- **Lazy modals:** one `LazyModal` wrapper, mounted on first open, replaces the `lazyLoad` store and its three hand-written effects.
- **Calm home:** `uiStore.anyModalOpen` (derived) includes the install modal. The share handoff marks itself settled on cancel too, so the donation reminder follows its spec.
- **Timers:** every timer gets cleanup (the context-menu reset, copy feedback, the wizard step reset).
- **Speed display:** speed decays to 0 after 3 s without a byte change.
- **Share page:** `goto("/")` on peer leave lives in one place.
- **Signaling client:** detach the socket's handlers before closing it. `suspend` and `disconnect` merge into `stop()`. The heartbeat becomes a single interval with a `lastPong` timestamp.
- **Small fixes:**
  - `zipDownload` uses a `TransformStream` per entry, which gives it backpressure;
  - preference and identity saves await `setItem`;
  - `formatBytes` clamps values below 1.
- **Dead code and other deletions:**
  - `clearToasts`, `formatDuration`, `getTreeFileIds`, unused logger levels, undefined or unused CSS, the duplicate Sair button;
  - the redundant `finishSuccess` effect and the nested ternary in `FileTreeActionsModal`;
  - the duplicate client-side public-IP check (`net/privateIp.ts`): the trimmed ipify text is still fetched and sent as `publicIpv4`, and the backend's `is_public_ipv4` stays the one validation. Fetching the IPv4 in the browser stays, because behind Cloudflare Tunnel the backend cannot see it (see Context).

### D7. Tooling and tests

- **Dependencies:**
  - remove `ws`, `@types/ws`, `vite-plugin-sveltekit-ws`, `src/lib/server/`, and the `start`/`prepush` scripts;
  - remove the `#lib` bare alias, `csrf.trustedOrigins`, `allowedHosts`, and the stale comments;
  - move `client-zip`, `localforage` and `svelte-comp-lazyloader` to `dependencies`;
  - drop the stale entries in the root `pnpm-workspace.yaml`, and pin pnpm in the Dockerfile from `packageManager`.
- **Husky hooks:** resolve pnpm with `command -v pnpm`, falling back to `$HOME/.local/share/pnpm`.
- **Vitest (latest),** Node environment, tests next to the engine as `*.test.ts`. A paired in-memory `Link` drives the sender and the receiver against each other and against scripted peers. There is one test per spec scenario in the delta and per engine bug from investigation.
- **Playwright:** `webServer` becomes an array: the Rust backend on 8080 (`cargo run -p drop-backend`), then Vite on 4321. New specs: manual pull, folder send, cancel mid-transfer, resume after a peer reload, and a multi-chunk file (more than 1 MiB). Each checks the received bytes through `page.waitForEvent("download")` and a SHA-256 comparison.
- **`make test`** runs `cargo test --workspace`, then `pnpm --dir frontend exec vitest run`, then Playwright. The manual backend start goes away, since Playwright now does it.
- **`tsconfig`** includes `tests/` so specs are type-checked.

## Risks / Trade-offs

- [The engine rewrite can regress flows the tests don't cover (desktop streaming, the Android share target, zip)] → Group order puts the tests first. Vitest covers the engine. The old engine stays until the new one passes Vitest and the full Playwright suite, then it is deleted in one task. A manual check of desktop and Android share-target flows ends the group.
- [fastrtc internals are minified; `Peer.ready` semantics are unclear] → The `Link` adapter waits for both channels to report `open` itself, instead of relying on `ready`.
- [The 4-byte header costs 4 bytes of every chunk and adds one buffer copy] → One `Uint8Array` allocation per chunk, at most 256 KiB, which is negligible next to the disk and network.
- [The CLI and the browser must ship together] → Both are in one change and one deploy. The Docker image embeds the matching CLI and desktop builds.
- [The hard-coded `allowedHosts` dev domain is removed] → It can be set through an env var (`VITE_ALLOWED_HOSTS`) if the remote dev setup still needs it.
- [Playwright starting the backend adds a cargo build to the first run] → It reuses an already running server through `reuseExistingServer`, as Vite does today.

## Migration Plan

1. Test tooling: Vitest setup, and Playwright starting the backend and checking received bytes.
2. Dead code, dependencies and config.
3. Protocol change in the Rust CLI and the new browser engine, each with its unit tests. Switch `peerSession`/`transferService` over, delete the old engine, and add the byte-checking Playwright specs.
4. Platform layer trim and adapter fixes, each with its tests.
5. UI fixes and deduplication, each with its tests.
6. Full verification and a deploy through the existing workflow.

Rollback: revert the merge. Images are tagged by commit SHA, so the previous image restores both the web app and the matching client downloads.

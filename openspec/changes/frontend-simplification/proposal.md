# Proposal

## Why

The frontend is about 9k lines for an app that pairs two devices and streams files between them. Investigation found a transfer engine of about 1,500 lines spread over six classes that share mutable state. It has real defects: a sender that stalls forever, corrupted resumes after a re-pull, leaked download streams, and bytes from an aborted file written into the next one. There are also dead dependencies, a dead server module, duplicated UI and helpers, and tests that check one small file by its UI text. The app is not public yet, so the peer protocol can still change freely.

## What Changes

**Peer protocol (browser and Rust CLI change together)**

- **BREAKING** Every `files` frame starts with a 4-byte stream ID that the sender assigns in `start`. The receiver drops frames whose stream ID is not the current one, so late chunks from an aborted, cancelled, or dismissed file can no longer land in the next file. No version negotiation: older clients are not supported.
- The sender waits at most 30 s for `resume` and 15 s for `ack`, then fails that file and moves on (the CLI already does this).
- A failed file read on the sender sends `cancel` for that file and continues with the queue instead of stalling.
- A re-pulled file always waits for a fresh `resume`. A stale offset from an earlier attempt is never reused.
- Every peer sizes frames so a whole frame (header included) fits `min(SCTP maximum, 256 KiB)`, with 64 KiB when the maximum is unknown, so the chunk is 4 bytes smaller than that limit. Before this, a browser reporting a huge SCTP maximum deadlocked the sender.
- Dismissing a pending offer always sends `download-aborted`, so the sender stops waiting for the pull.
- `batch-done` is sent once per finished batch, not on every queue check.
- A `pull-batch` with one file finishes its zip like any other batch.

**Transfer engine rewrite (browser)**

- Replace the sender, receiver, session, and transfer-manager classes with one sequential sender loop and one receiver keyed by the current file, modelled on `crates/cli/src/transfer/{send,receive}.rs`.
- Cleanup on peer loss closes every open download writer and zip before the state is reset. Errors in the write queue are caught instead of silently stopping later writes.

**Platform layer (quick-di kept)**

- Remove ports with only one real implementation (`DesktopApi` as a port, `ClipboardPort`). Merge `isDesktop`/`hasDesktopFs`. Delete the dead `desktopWatch.ts` and the duplicated bridge types.
- Fix the adapter bugs:
  - two reads of one path share a streamer reader and corrupt each other;
  - an unregistered service worker hangs startup;
  - the bridge connect timeout leaks the socket;
  - the desktop finalize step can overwrite a same-named file;
  - service-worker downloads have no backpressure.

**UI and helpers**

- Fix UI bugs:
  - an announce frame is sent per keystroke while on `/share`;
  - the context-menu reset timer is never cleared;
  - leaving the share page navigates twice;
  - auto-download is persisted twice;
  - a stalled transfer keeps showing its last speed;
  - the donation reminder shows while the install modal is open, or never after a cancelled share handoff;
  - signaling `suspend`/`resume` races and shows a false "Desconectado" toast;
  - zip downloads have no backpressure;
  - preference and identity saves are not awaited;
  - `formatBytes` breaks below 1.
- Remove duplication: device preference fields shared by the setup wizard and settings, the PIX copy block, copy-feedback timers, the `CodeJoinPhase` type, pending-receive filters, lazy-modal mounting.

**Dead code, dependencies, and config**

- Delete `src/lib/server/signaling/handler.ts` and the `ws`, `@types/ws`, and `vite-plugin-sveltekit-ws` dependencies.
- Drop:
  - the `start` and `prepush` scripts and the `#lib` alias to a missing file;
  - `csrf.trustedOrigins`, stale comments, and the hard-coded `allowedHosts` domain;
  - stale pnpm build approvals;
  - unused exports and CSS;
  - the duplicate client-side public-IP check. The browser still fetches its IPv4 and sends `publicIpv4`, because behind Cloudflare Tunnel the backend cannot see it; only the backend validates it.
- Fix the husky hooks' hard-coded `PNPM_HOME`. Pin pnpm in the Dockerfile. Move runtime packages to `dependencies`.

**Tests**

- Add Vitest unit tests for the transfer engine: stream-ID filtering, resume, re-pull, abort cleanup, timeouts, read failure, chunk cap.
- Add Playwright specs that check received bytes: manual pull, folder send, cancel mid-transfer, resume after a dropped peer, a multi-chunk file.
- Playwright starts the Rust backend itself, so `pnpm test:e2e`, the pre-push hook, and `make test` behave the same.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli/file-transfer`: the negotiated chunk size leaves room for the 4-byte frame header.
- `file-transfer`: chunk frames carry a stream ID and stale frames are dropped; the sender gives up on a missing `resume` or `ack` after a timeout; a failed read cancels the file instead of stalling; a re-pull needs a fresh `resume`; the chunk size is capped for every peer; dismissing a pending offer notifies the sender; `batch-done` once per batch.

## Impact

- **Frontend:**
  - `src/lib/utils/webrtc/*` (rewritten);
  - `src/lib/services/{transferService,queueService}.ts`;
  - `src/lib/ports/*`, `src/lib/adapters/{web,desktop}/*`, `src/service-worker/index.ts`;
  - stores, components, and routes with the fixes above;
  - `src/lib/utils/**` helpers;
  - `package.json`, `vite.config.ts`, `playwright.config.ts`, new Vitest config and tests.
- **Rust desktop host:** `crates/desktop/src/fs.rs`: `fs.move` refuses to overwrite.
- **Rust CLI:** `crates/cli/src/protocol.rs`, `transfer/{send,receive}.rs` and their tests, `crates/cli/tests/transfer.rs` (stream-ID framing).
- **Tooling:** root `pnpm-workspace.yaml`, `.husky/pre-commit`, `.husky/pre-push`, `Dockerfile` (pnpm pin), `Makefile` (test target if Playwright starts the backend).
- **Dependencies:** removes `ws`, `@types/ws`, `vite-plugin-sveltekit-ws`; adds `vitest`. quick-di stays.
- **Compatibility:** browser, CLI, and desktop must run the same build. Old CLI binaries stop working with the new web app. Accepted, since the app is not public.
- **Wire contracts unchanged:** signaling JSON, the desktop bridge methods, and the streamer endpoints.

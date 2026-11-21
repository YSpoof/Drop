# Tasks

Conventions for every group: frontend commands run from the repo root with `pnpm --dir frontend …`; cargo runs as `nice -n 3 cargo …`; `Promise.withResolvers` instead of `new Promise`, no nested ternaries, no file above 800 lines. Design references (D1–D7) point at `design.md`. After each group: `pnpm --dir frontend run check`, `pnpm --dir frontend run build`, and the Playwright suite pass.

## 1. Test tooling

- [x] 1.1 Add `vitest` (latest) as a devDependency with a Node-environment config that picks up `src/**/*.test.ts`, add a `test:unit` script, and include `tests/` in `tsconfig.json`; verify `pnpm --dir frontend exec vitest run` runs (a trivial placeholder test passes) and `pnpm --dir frontend run check` still reports 0 errors.
- [x] 1.2 Make Playwright `webServer` an array that starts the Rust backend on 8080 (`cargo run -p drop-backend`, `reuseExistingServer`) before Vite on 4321, and simplify the `make test` target to `cargo test --workspace`, then `vitest run`, then Playwright; verify `pnpm --dir frontend exec playwright test` passes from a clean state with no backend running beforehand, and `make test` passes.
- [x] 1.3 Add a Playwright helper that saves a download and returns its SHA-256, and switch `tests/connections/code-join.spec.ts` to assert the received bytes of `hello.txt` instead of only UI text; verify the spec passes.

## 2. Dead code, dependencies, and config

- [x] 2.1 Delete `src/lib/server/` and remove `ws`, `@types/ws`, and `vite-plugin-sveltekit-ws`, plus `SHARE_CODE_RANGE`, which then has no importer; verify `grep -rn "from \"ws\"\|sveltekit-ws\|SHARE_CODE_RANGE" frontend/src frontend/vite.config.ts` finds nothing and the lockfile no longer lists those packages.
- [x] 2.2 In `frontend/package.json`: remove the `start` and `prepush` scripts and the bare `#lib` import alias, and move `client-zip`, `localforage`, and `svelte-comp-lazyloader` to `dependencies`. In `vite.config.ts`: remove `csrf.trustedOrigins` and the stale comments, and read `allowedHosts` from `VITE_ALLOWED_HOSTS`. Verify check, build, and Playwright pass.
- [x] 2.3 Clean the root `pnpm-workspace.yaml` (drop the `bufferutil`, `utf-8-validate`, `es5-ext`, and `better-sqlite3` approvals and the `adapter-node` exclusion; keep one build-approval list), pin pnpm in the Dockerfile from `packageManager`, and make `.husky/pre-commit` and `.husky/pre-push` find pnpm with `command -v pnpm` and fall back to `$HOME/.local/share/pnpm`; verify `pnpm --dir frontend install --frozen-lockfile` succeeds and both hooks run from a shell without `PNPM_HOME` set.
- [x] 2.4 Remove the unused exports and CSS: `clearToasts`, `formatDuration`, `getTreeFileIds`, the unused logger levels, the `gelatin`, `toast-progress-fill`, `--animate-fade-in-scale`, and `--cardId` leftovers, and the impossible `disabled={cantClose}`. Also remove the duplicate client-side public-IP check (`net/privateIp.ts`), but keep fetching the IPv4 from ipify and sending the trimmed value as `publicIpv4` in `announce` (needed behind Cloudflare Tunnel). Verify that a grep for each removed name finds no reference, that check, build, and Playwright pass, and that the `announce` frame still carries `publicIpv4` (check the WebSocket frames in Playwright).

## 3. Protocol change and transfer engine

- [x] 3.1 Rust CLI (D1): add `stream_id: u32` to `Ctrl::Start`, a per-connection counter in `send.rs`, the 4-byte big-endian header on every `files` frame, and filtering by the current stream and the resume-sent state in `receive.rs`. Update the protocol, send, and receive tests, and add tests for dropping late frames of an aborted file and frames received before `resume`. Verify `nice -n 3 cargo test -p drop-cli`, including `--test transfer`.
- [x] 3.2 Create `src/lib/transfer/protocol.ts` (D4) with the control message types including `streamId`, encode and decode, and frame header pack and unpack, plus `protocol.test.ts` asserting exact JSON field names and the header layout; verify the Vitest tests pass.
- [x] 3.3 Define the `Link` and `Hooks` interfaces and an in-memory paired `Link` test fixture in `src/lib/transfer/`; verify that a fixture self-test passes, sending control messages and frames each way.
- [x] 3.4 Implement `src/lib/transfer/receive.ts` (D3): offers map, single current receive, aligned resume, mandatory `resume` reply, `download-aborted` for unknown or dismissed starts, 1 MiB credits, size check with `ack` or `cancel`, a write queue that catches errors, snapshot-then-close cleanup, zip per pull batch. Add `receive.test.ts` covering every receiver scenario in the delta spec and the leaked-stream and dead-write-queue bugs. Verify the Vitest tests pass.
- [x] 3.5 Implement `src/lib/transfer/send.ts` (D2): the sequential loop, `streamId` per start, per-start `resume` wait (30 s) and `ack` wait (15 s), 8 MiB window, chunk size `min(maxMessageSize, 256 KiB)` with a 64 KiB fallback, one `AbortController` per file, `cancel` on read failure, `batch-done` once per batch. Add `send.test.ts` covering every sender scenario in the delta spec and the stale-resume, read-stall, huge-maximum, and ack-for-another-file bugs, using fake timers for the timeouts. Verify the Vitest tests pass.
- [x] 3.6 Implement `src/lib/transfer/engine.ts` (control dispatch, `download-mode`, `pull`, `pull-batch`, `bye`) and an engine test that runs a sender and a receiver against each other over the paired `Link`: single file, multi-chunk file, resume, cancel mid-transfer, and a dismissed offer. Verify the Vitest tests pass.
- [x] 3.7 Switch over: `peerSession.ts` builds the `Link` from the fastrtc channels (waiting for both to be `open`), and `transferService.ts` implements `Hooks`; `queueService.ts` calls the engine. Then delete the old `utils/webrtc/{session,sender,receiver,transfer,protocol}.ts` and `TransferCallbacks`. Verify `grep -rn "TransferManager\|TransferSession\|TransferCallbacks" frontend/src` finds nothing, and check, build, Vitest, and Playwright pass.
- [x] 3.8 Add Playwright specs that check received bytes: manual pull with auto-download off, folder send, cancel mid-transfer, resume after the receiver reloads mid-download, and a file larger than 1 MiB. Verify they pass.
- [x] 3.9 Cross-client check: run the Rust CLI (`cargo run -p drop-cli -- --quick --host <file>`) against the browser through the Rust backend in both directions, and compare SHA-256 sums; verify both transfers complete with identical sums.

## 4. Platform layer

- [x] 4.1 Trim ports (D5): delete `ports/desktopApi.ts` and `ports/clipboard.ts` with their adapters and providers entries; add a `copyText()` helper and switch its callers; merge `hasDesktopFs` into `isDesktop`; replace `FileReaderPort.desktopPath` with a `filePath(file)` helper; delete `adapters/desktop/desktopWatch.ts` and the duplicate `StatResult`/`DirEntry` types. Verify a grep for each removed name finds nothing, and check, build, Vitest, and Playwright pass.
- [x] 4.2 Fix `desktopStreamerClient.ts` so each read session owns its reader (D5), and add a Vitest test with a fake `fetch` proving that two concurrent reads of one path at the same offset both return the correct bytes; verify the test passes.
- [x] 4.3 Fix the desktop bridge connect: on timeout close the pending socket, set `session` only on success, and give `callRpc` a timeout. Fix the desktop finalize to never overwrite (retry with the next free name). Add Vitest tests with a fake WebSocket for the timeout and the RPC timeout; verify they pass.
- [x] 4.4 Fix the service-worker download path: `ensureReady` times out and falls back to a direct download, chunks are posted with transfer lists and backpressure (D5), the abort affects only this tab's downloads, and the dead `readableStream`/`ping` branches and the duplicate message listener are removed. Verify the Playwright download specs pass and a large (more than 64 MiB) received file does not grow page memory past the window (check `performance.memory` or a heap snapshot in Chromium).
- [x] 4.5 Manual check: the desktop host with `DROP_URL=http://localhost:4321` (`make dev-desktop`) sends and receives a file, resumes a partial receive, and a watched folder reports a new file.

## 5. UI fixes and deduplication

- [x] 5.1 Signaling client (D6): detach handlers before closing a socket, merge `suspend`/`disconnect` into `stop()`, single-interval heartbeat; add a Vitest test with a fake WebSocket proving `stop()` then a reconnect does not fire `onClose` or schedule a second reconnect; verify it passes.
- [x] 5.2 Fix the helpers: `zipDownload` backpressure through a `TransformStream` per entry, and recovery when creating the writable fails; awaited `setItem` in `prefs.ts` and `identity.ts`; `formatBytes` for values below 1. Add Vitest tests for each; verify they pass.
- [x] 5.3 Fix the `/share` effects: `untrack` around `session.announce()`, remove the redundant `finishSuccess` effect, and keep one `goto("/")` on peer leave. Add a Playwright check that typing a new display name in Settings while on `/share` does not send extra `announce` frames (count WebSocket frames). Verify it passes.
- [x] 5.4 Extract `DevicePrefsFields.svelte` (used by `SetupWizard` and `SettingsModal`), move auto-download persistence into one `transferStore` setter, add `PixKeyButton.svelte` and `createCopied()` (clears its timer), and use them in `InfoModal`, `DonationReminderModal`, and `ShareStatus`; verify check, build, and Playwright pass and the setup wizard, settings, and PIX copy still work in the browser.
- [x] 5.5 Replace the `lazyLoad` store and its three effects with a `LazyModal` wrapper; add `uiStore.anyModalOpen`, including the install modal; mark the share handoff settled on cancel. Add a Playwright check that the donation reminder does not open while the install modal is open. Verify check, build, and Playwright pass.
- [x] 5.6 Fix the remaining UI bugs:
  - clear the context-menu reset timer (`FileTreeView`);
  - decay speed to 0 after 3 s without progress (`TransferProgress`);
  - close the add popover after picking (`Files`);
  - clear the wizard step-reset timer;
  - `dark:bg-base-300` in `NavBar`;
  - render the Sair button once;
  - one exported `CodeJoinPhase` type;
  - one `pendingReceived` derived value;
  - a `switch` instead of the nested ternary in `FileTreeActionsModal`;
  - derive `pathStack` instead of fixing it in an effect.

  Verify check, build, and Playwright pass.

## 6. Final verification

- [x] 6.1 Run `make test` (cargo, Vitest, Playwright), the Docker build (`docker buildx build --build-arg BUILD_SHA=test -t drop:test .`), and `wc -l` over `frontend/src`; verify all pass and record the line count before and after in this task's notes. — Recorded: `make test` passed (cargo: cli 260+4, core 30, desktop 34, backend 31; Vitest 150; Playwright 22). Docker build passed and served `/health` `"sha":"test"`. `frontend/src` app code (ts+svelte, without tests) went from 8,980 to 8,276 lines (−704), plus 3,182 lines of new unit tests. That misses the design goal of roughly 7k.
- [x] 6.2 Manual check on real devices: browser to browser over LAN (file, folder, manual pull, dismiss), Android share target into the queue, and zip download of a pull batch; verify each transfer's checksum matches.
- [x] 6.3 Run `openspec validate frontend-simplification --strict`; verify it reports the change as valid.

## Workflow follow-up

- Archive the change after review.

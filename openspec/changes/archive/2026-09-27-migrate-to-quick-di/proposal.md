# Proposal

## Why

All composition lives in `src/lib/runtime.ts` as a hand-built `new` graph, while `quick-di` is already a dependency and is the library meant to own that graph. Importing `runtime.ts` constructs every service, and every service takes its dependencies as constructor arguments instead of `inject()`.

## What Changes

- `runtime.ts` only configures the platform and, when native, starts Neutralino. It exports no services.
- Platform bindings live in `nativeProviders.ts` and `webProviders.ts`. `runtime.ts` passes one of those arrays to `configure()`.
- Each port in `src/lib/ports/` becomes an abstract class token. The `Port` suffix goes away (`EnvironmentPort` becomes `Environment`, and the same for the other ports). `NativeApi` keeps its name.
- Container-managed classes take dependencies with field `inject()`. Concrete services (`DownloadService`, `FolderWatcher`, `QueueService`, `TransferService`) have no `provide` entry. quick-di builds them on first `inject()`.
- Call sites stop importing singletons from `#lib/runtime.js`. A class field-injects the token. A function or Svelte instance script calls `inject(Token)` at the point of use. The singleton is cached, so later calls return the same instance.
- Leave per-connection values (channels, callbacks, session accessors, zip filenames) as constructor arguments. Those are not container services.
- No user-visible behavior change. Platform choice, the web clipboard on native, and the receive-folder path fallback stay as they are. `QueueService` still calls `folderWatcher.init`, but on first `inject(QueueService)` instead of at `runtime.ts` import.

Assumption: Svelte stores and the signaling server stay outside the container. `SessionManager` and `PeerSessionCoordinator` stay `new`'d per share session. They field-inject container services. They are not provider entries.

## Capabilities

### New Capabilities

- None. This is a pure refactor. Externally observable behavior does not change, so no new spec is introduced.

### Modified Capabilities

- None. `donation-reminder` requirements stay as they are. `skip_specs: true` is set because this change does not alter spec-level behavior.

## Impact

- `src/lib/runtime.ts`, new `src/lib/adapters/native/nativeProviders.ts` and `src/lib/adapters/web/webProviders.ts`, `src/lib/ports/*`, the web and native adapters, `DownloadService`, `FolderWatcher`, `QueueService`, and `TransferService`.
- `TransferManager`, `TransferReceiver`, and `ZipDownloadSession` where they currently take `DownloadService` or `EnvironmentPort` through the constructor.
- `SessionManager` and `PeerSessionCoordinator` field-inject `QueueService`, `DownloadService`, and `TransferService` instead of importing them from `runtime.ts`.
- Every current `#lib/runtime.js` singleton import switches to `inject(Token)`. `src/routes/+layout.svelte` imports `#lib/runtime.js` for the `configure()` side effect.
- `quick-di` is already in `package.json` (`^1.0.0`). No new dependency.
- Client-only (`ssr = false`). No server container. This change adds no tests. A later test can pass another provider array to `configure()`, or use `runInScope()` (synchronous only in the browser).

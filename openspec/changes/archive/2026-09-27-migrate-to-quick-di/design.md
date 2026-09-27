# Design

## Context

See proposal.md for why. Client-only SvelteKit app (`ssr = false` in `src/routes/+layout.ts`).

`src/lib/runtime.ts` is the composition root. On import it calls `isNative()`, starts Neutralino when that is true, and `new`s one adapter per port plus `DownloadService`, `FolderWatcher`, `QueueService`, and `TransferService`. `QueueService`'s constructor calls `folderWatcher.init`. Fifteen files import those singletons from `#lib/runtime.js`.

Ports in `src/lib/ports/` are type aliases. Adapters `implement` them. `quick-di` tokens are constructors (`abstract new (...args) => T`). The installed `useClass` path is `new Provider.useClass` with no arguments (`node_modules/quick-di`). `configure()` only stores providers. `inject()` builds on first use and caches the instance on the global container. A second `configure()` for a token drops that token's cached singleton.

`neutralinoApi` is a plain object and owns the open write-stream map. Clipboard is `WebClipboard` on both platforms. `NativeFsFileAdapter` takes a `getDir` closure: `transferStore.receiveFolderPath`, else `receiveFolder.defaultPath()`, else `""`.

Per-connection objects stay `new`'d by their owners: `TransferManager` (channels and callbacks), `ZipDownloadSession` (filename), `SessionManager` (page accessors), `PeerSessionCoordinator`, `CodeJoinController`. `TransferManager` and `TransferReceiver` also take `DownloadService` and `EnvironmentPort`. `ZipDownloadSession` takes `DownloadService`.

## Goals / Non-Goals

**Goals:**

- `runtime.ts` only calls `configure()` and, when native, `startNeutralino()`. No service exports.
- One provider array per platform. Adding a platform adds an array, not constructor ternaries inside domain services.
- Dependencies and root services are created on first `inject()`, not when `runtime.ts` is imported.
- Preserve native-vs-web choice, Neutralino startup before any native call, the `getDir` fallback, and the web clipboard on native.

**Non-Goals:**

- Putting Svelte stores or the signaling server in the container.
- Registering `SessionManager`, `PeerSessionCoordinator`, `TransferManager`, or `ZipDownloadSession` as providers.
- `transient` providers, or a second composition root.
- New tests.

## Decisions

### `runtime.ts` configures only

```ts
const native = isNative();
configure(native ? nativeProviders : webProviders);
if (native) startNeutralino();
```

`configure()` does not construct. `startNeutralino()` runs after `configure()` and before any later `inject()`, so the Neutralino client is up before a native adapter method runs. `+layout.svelte` imports `#lib/runtime.js` before `pageUnload.js`. ESM evaluates that import first, and the module runs `configure()` once.

No file calls `inject()` at module scope. A module-scope `inject()` can run while some other module is still loading, before `runtime.ts`. An unconfigured abstract token is not rejected: TypeScript erases `abstract`, and quick-di will `new` an empty object.

Call sites:

- A class field-injects: `private readonly downloads = inject(DownloadService)`.
- A function calls `inject(Token)` inside the function.
- A Svelte component calls `inject(Token)` in the instance script, not in `<script module>`.

`inject()` returns the cached singleton after the first call.

Alternative: `export const queueService = inject(QueueService)` from `runtime.ts`. That still builds every exported service when any file imports `runtime.ts`. Rejected.

Alternative: getters such as `queueService()`. That is lazy, and every `queueService.foo` call site becomes `queueService().foo`. Field `inject()` and `inject()` at the use site keep the call on the instance. Rejected.

### Provider arrays

`src/lib/adapters/web/webProviders.ts` exports `webProviders`. `src/lib/adapters/native/nativeProviders.ts` exports `nativeProviders`. Both include `Clipboard` → `WebClipboard`, so the `configure()` line stays one choice.

Web: `Environment` → `WebEnvironment`, `Notifications` → `WebNotifications`, `Watcher` → `WebWatcher`, `Picker` → `WebPicker`, `FileAdapter` → `SwFileAdapter`, `FileReader` → `WebFileReader`, `ReceiveFolder` → `WebReceiveFolder`, `Clipboard` → `WebClipboard`.

Native: `NativeApi` → `useValue: neutralinoApi`, `Environment` → `NativeEnvironment`, `Notifications` → `NativeNotifications`, `Watcher` → `NativeWatcher`, `Picker` → `NeutralinoPicker`, `FileAdapter` → `NativeFsFileAdapter`, `FileReader` → `NativeFileReader`, `ReceiveFolder` → `NativeReceiveFolder`, `Clipboard` → `WebClipboard`.

No `NativeApi` provider on web. Web classes must not `inject(NativeApi)`.

`DownloadService`, `FolderWatcher`, `QueueService`, and `TransferService` are absent from both arrays. First `inject(QueueService)` builds it, which field-injects `FolderWatcher`, which field-injects `Watcher` and `FileReader`.

Alternative: a `NeutralinoApi` class. That moves the stream map for no gain. `useValue` keeps the existing object.

A third platform is another array and a new branch where `runtime.ts` picks the array. Domain classes stay as they are.

### Abstract class tokens and field `inject()`

Each port becomes an abstract class. Drop the `Port` suffix: `Clipboard`, `Environment`, `FileReader`, `Notifications`, `ReceiveFolder`, `Picker`, `Watcher`, `FileAdapter`. `NativeApi` stays. `PickedFile` and `WatcherEvent` stay types.

Adapters `extend` the token. Classes that need another container type use `private readonly dep = inject(Token)` and take no constructor arguments for those dependencies. `useClass` is `new Class` with no arguments.

`QueueService`'s constructor still calls `folderWatcher.init` after the fields are set. That runs on first `inject(QueueService)`, not at `runtime.ts` import. Watch setup goes through `QueueService`, so nothing needs the watcher before that instance exists.

### `getDir` moves into `NativeFsFileAdapter`

The adapter `inject`s `NativeApi` and `ReceiveFolder` and keeps the direct `transferStore` import. Directory resolution stays `transferStore.receiveFolderPath || (await receiveFolder.defaultPath()) || ""`. `ReceiveFolder` does not depend on the file adapter, so this is not a cycle.

### Defaults for the optional file-adapter methods

`FileAdapter` today has optional `getResumeOffset` and `dropIncomplete`. Only `NativeFsFileAdapter` implements them. `DownloadService` uses `?.` and falls back to `0` / `Promise.resolve()`. Put those fallbacks on the abstract class as concrete methods. `NativeFsFileAdapter` overrides them. `DownloadService` calls them directly. `SwFileAdapter` inherits the fallbacks.

### Per-connection objects keep value arguments

`TransferManager` and `TransferReceiver` field-inject `DownloadService` and `Environment`. Their constructors keep the channel, callback, and session arguments. `TransferService.startTransferManager` stops passing the two services into `new TransferManager`. `ZipDownloadSession` field-injects `DownloadService` and keeps the filename and abort callback.

`SessionManager` field-injects `QueueService`. `PeerSessionCoordinator` field-injects `DownloadService` and `TransferService`. Neither class becomes a provider. Their other constructor arguments stay.

### Tests later, not in this change

`configure(mockProviders)` replaces the listed tokens and drops their cached singletons. `runInScope(mockProviders, fn)` overrides for the callback and, in this client bundle, is synchronous only. No test in this change uses either.

## Risks / Trade-offs

- [Unconfigured abstract port is constructed as an empty object] → `configure()` lives only in `runtime.ts`. `+layout.svelte` imports that module before `pageUnload.js`. No other file calls `inject()` at module scope.
- [`useClass` passes no constructor arguments] → Container-managed classes take zero constructor arguments for dependencies. A leftover parameter becomes `undefined` at runtime.
- [`QueueService` init moves from import to first `inject(QueueService)`] → Watchers are started from `QueueService` methods, which run on that same instance after `init`.
- [`getDir` fallback drifts while moving into the adapter] → Keep the same expression, including the empty-string fallback.
- [Web code `inject`s `NativeApi`] → Do not register it on the web list, and do not `inject` it from web classes.
- [Calling `configure()` again drops singletons] → Only `runtime.ts` calls it, and ESM evaluates that module once.
- [Subclass methods that omit unused port parameters fail `svelte-check`] → Add the unused parameters if the checker rejects the override. `WebWatcher` is the likely case.

## Migration Plan

1. Convert ports, then adapters, then services, then per-connection constructors, then add the provider arrays and replace `runtime.ts`.
2. Switch every `#lib/runtime.js` singleton import to `inject(Token)`, and import `runtime.ts` from the layout.
3. Run `pnpm check`. No new tests.
4. Rollback is reverting the change. No stored data and no flag.

## Open Questions

None.

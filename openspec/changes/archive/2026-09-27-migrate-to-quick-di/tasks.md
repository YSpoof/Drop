# Tasks

## 1. Port tokens

- [x] 1.1 Turn the ports into abstract classes and drop the `Port` suffix: `Clipboard`, `Environment`, `FileReader`, `Notifications`, `ReceiveFolder`, `Picker`, `Watcher`. `NativeApi` stays. Keep `PickedFile` and `WatcherEvent` as types. Verify each of those names is an abstract class and those two names are still types.

- [x] 1.2 Turn `FileAdapter` into an abstract class. `createWritableStream`, `abortAll`, and `ensureReady` stay abstract. `getResumeOffset` returns `0`. `dropIncomplete` returns `Promise.resolve()`. Verify `SwFileAdapter` is not required to override those two methods.

## 2. Adapters

- [x] 2.1 Change every adapter that `implements` a port so it `extends` that token with a value import. `NativeFileReader`, `NativeReceiveFolder`, and `NativeWatcher` drop constructor arguments and field-inject `NativeApi`. `NativeFsFileAdapter` field-injects `NativeApi` and `ReceiveFolder`, and resolves the directory as `transferStore.receiveFolderPath || (await receiveFolder.defaultPath()) || ""`. Verify those four classes have no constructor parameters and the directory expression is unchanged.

- [x] 2.2 Leave `neutralinoApi` as the existing object. Confirm web adapters (`WebClipboard`, `WebEnvironment`, `WebFileReader`, `WebNotifications`, `WebPicker`, `WebReceiveFolder`, `WebWatcher`, `SwFileAdapter`) extend their tokens and do not `inject(NativeApi)`. If `svelte-check` later rejects a shorter override such as `WebWatcher.watch`, add the unused parameters.

## 3. Services

- [x] 3.1 `DownloadService` field-injects `FileAdapter` and calls `getResumeOffset` and `dropIncomplete` directly. `FolderWatcher` field-injects `Watcher` and `FileReader`. `QueueService` field-injects `FileReader` and `FolderWatcher`, and its constructor still calls `folderWatcher.init`. `TransferService` field-injects `FileReader`, `DownloadService`, and `Environment`. Verify none of these four classes take constructor arguments, and `QueueService` still calls `init` in the constructor.

## 4. Per-connection objects

- [x] 4.1 `TransferManager` and `TransferReceiver` field-inject `DownloadService` and `Environment` and keep channel, callback, and session constructor arguments. `ZipDownloadSession` field-injects `DownloadService` and keeps the filename and abort callback. `TransferService.startTransferManager` stops passing the two services into `new TransferManager`. `SessionManager` field-injects `QueueService`. `PeerSessionCoordinator` field-injects `DownloadService` and `TransferService`. Verify those classes are not added to a provider array.

## 5. Bootstrap

- [x] 5.1 Add `src/lib/adapters/web/webProviders.ts` and `src/lib/adapters/native/nativeProviders.ts` with the arrays in `design.md`. `Clipboard` → `WebClipboard` is in both. `NativeApi` → `useValue: neutralinoApi` is only in the native array. `DownloadService`, `FolderWatcher`, `QueueService`, and `TransferService` are in neither. Verify both files export one array.

- [x] 5.2 Replace the body of `src/lib/runtime.ts` with `configure(native ? nativeProviders : webProviders)` and, when native, `startNeutralino()` after `configure()`. Export nothing. Verify the file contains no `inject(`, no `new DownloadService`, and no `export const`.

## 6. Use sites

- [x] 6.1 Import `#lib/runtime.js` from `src/routes/+layout.svelte` before the `pageUnload.js` import. Verify that import is first among the `#lib` imports.

- [x] 6.2 Replace every singleton import from `#lib/runtime.js` with `inject(Token)` at the point of use. Classes use a field. Functions call `inject` inside the function. Svelte instance scripts call `inject` there, not in `<script module>`. Files: `+page.svelte`, `share/+page.svelte`, `FileDropZone.svelte`, `Files.svelte`, `InstallAppButton.svelte`, `DonationReminderModal.svelte`, `SetupWizard.svelte`, `SettingsModal.svelte`, `InfoModal.svelte`, `ShareStatus.svelte`, `dropHandlers.svelte.ts`, `sessionSetup.svelte.ts`, `pageUnload.ts`. Verify no file except `+layout.svelte` imports `#lib/runtime.js`, and no file calls `inject()` at module scope.

## 7. Integration

- [x] 7.1 Run `pnpm check` and verify it exits 0. Do not add tests.

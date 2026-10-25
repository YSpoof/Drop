# Tasks

## 1. Go Native Desktop Host (`native/desktop`)

- [x] 1.1 Scaffold `native/desktop` Go module following the modular layout and composition root pattern from `/home/zero/Projects/Ours/RegistryUI/` and verify `go build` succeeds
- [x] 1.2 Implement Chrome process launcher (`chrome.go`) adapted from `/home/zero/Projects/Others/PointTracker/` with binary detection, `--app` launch, ephemeral profile management, and process supervision
- [x] 1.3 Implement HTTP byte streaming endpoints (`/read` and `/write`) incorporating the existing streamer logic and verify Range reads and POST writes with tests
- [x] 1.4 Implement WebSocket JSON-RPC server (`/bridge`) supporting FS operations (`stat`, `readDir`, `mkdir`, `remove`, `rename`, `getDownloadsPath`) and verify with tests
- [x] 1.5 Implement native dialog handlers (`pickFiles`, `pickFolder`) via `ncruces/zenity`
- [x] 1.6 Implement folder watcher (`watchFolder`, `unwatchFolder`) using `fsnotify` with in-process file size settlement and verify push event delivery on file addition and removal

## 2. Frontend SvelteKit Bridge & Adapters

- [x] 2.1 Implement `goNativeClient.ts` to read bootstrap port/token from launch URL query params, sanitize the browser address bar with `history.replaceState()`, and establish the WebSocket RPC connection
- [x] 2.2 Implement `goNativeApi.ts` fulfilling the `NativeApi` port via RPC and HTTP streaming endpoints, and verify with tests
- [x] 2.3 Implement `goNativePicker.ts` fulfilling `PickerPort` and `goNativeWatch.ts` fulfilling `WatcherPort`
- [x] 2.4 Wire Go adapters into `nativeProviders.ts` and update `src/hooks.client.ts` to initialize the Go native client with graceful fallback to `webProviders`

## 3. Removal of Neutralino & Build Cleanup

- [x] 3.1 Remove legacy Neutralino adapter files (`neutralinoApi.ts`, `neutralinoClient.ts`, `neutralinoFs.ts`, `neutralinoPicker.ts`, `neutralinoWatch.ts`) and standalone `native/extensions/streamer`
- [x] 3.2 Remove `@neutralinojs/neu`, `@neutralinojs/lib`, and `neutralino.config.json` from `package.json` and clean dependencies
- [x] 3.3 Update npm scripts (`native:dev`, `native:build`, `native:preview`) and packaging scripts to compile and launch the Go native desktop host

## 4. Verification and End-to-End Testing

- [x] 4.1 Run frontend type checking (`pnpm check`) and verify no TypeScript or linting errors
- [x] 4.2 Run end-to-end launch verification of the compiled Go native desktop shell to ensure successful Chrome `--app` launch, bridge connection, and provider initialization

## Workflow follow-up

- Archive the change after implementation and testing are verified.

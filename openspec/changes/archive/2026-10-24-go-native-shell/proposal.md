# Proposal

## Why

Drop desktop currently relies on the Neutralino C++ runtime to launch Chrome in app mode and provide OS APIs, and extracts a separate Go streamer sidecar binary at runtime to handle fast loopback file chunk streaming. This split architecture introduces unnecessary orchestration complexity (extracting binaries to `/tmp`, managing two distinct local communication channels, multi-process lifecycle synchronization) and limits platform extensibility.

Replacing Neutralino and the sidecar with a single unified Go desktop shell simplifies packaging, improves robustness, eliminates runtime binary extraction, and establishes a consolidated Go foundation for future native networking and transfer optimizations (such as Pion WebRTC).

## What Changes

- **Replace Neutralino Shell**: Remove the Neutralino framework binary, `@neutralinojs/neu`, `@neutralinojs/lib`, and `neutralino.config.json`.
- **Introduce Unified Go Native Shell**: Create a single Go desktop host executable (e.g. under `native/desktop/`) following the architecture patterns of `/home/zero/Projects/Ours/RegistryUI/` (composition root, structured HTTP server, clean routing) that:
  - Discovers local Chrome or Chromium installations and launches the browser in `--app` mode pointing to the remote UI (`https://drop.lzart.com.br` or dev URL) with an isolated temporary user data profile (pattern proven by `/home/zero/Projects/Others/PointTracker/`).
  - Starts an authenticated loopback HTTP and WebSocket server on an ephemeral port on `127.0.0.1`.
  - Integrates the file read/write HTTP streaming engine directly in-process (absorbing the existing `streamer` extension).
  - Implements native OS services via WebSocket RPC: native file and folder pickers (`zenity` / OS dialogs), directory and file operations (`stat`, `readdir`, `mkdir`, `remove`, `rename`), folder watching (`fsnotify`), system paths (downloads folder), and clipboard integration.
  - Monitors the browser process and cleanly exits when the Chrome window is closed.
- **Frontend Native Client Adapter**:
  - Replace `startNeutralino()` and `@neutralinojs/lib` calls with a lightweight Go native bridge client in SvelteKit.
  - Read port and authentication credentials passed by the Go shell via URL launch query parameters (e.g., `?dropPort=...&dropToken=...`), immediately sanitizing the browser address bar with `history.replaceState()`.
  - Implement `NativeApi`, `PickerPort`, and `WatcherPort` using the unified Go RPC and streaming endpoints.
  - Maintain graceful fallback to `webProviders` when running in a standard web browser.
- **Packaging and Build Pipeline**:
  - Update npm/build scripts and CI/Docker packaging to compile the Go desktop shell binary directly into desktop distributions instead of running `neu build`.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `native-shell`: Update the desktop shell specification to describe the Go-driven Chrome app host, ephemeral port/token bootstrap, in-process RPC bridge, and window lifecycle management instead of Neutralino framework socket mechanics.
- `native-file-streamer`: Update the native streamer specification to reflect that loopback file streaming is served in-process by the unified Go desktop host rather than an extracted sidecar child process.

## Impact

- **Frontend Code**:
  - `src/lib/adapters/native/neutralino*.ts` and `streamerClient.ts` are replaced by Go shell bridge adapters (`goNativeApi.ts`, `goNativeClient.ts`, `goNativePicker.ts`, `goNativeWatch.ts`, etc.).
  - `src/hooks.client.ts` bootstraps the Go host client instead of Neutralino.
  - Dependency `@neutralinojs/lib` removed from `package.json`.
- **Backend / Native Code**:
  - `native/extensions/streamer` is merged into a new unified Go desktop shell application (e.g. `native/desktop`).
  - Neutralino configuration (`neutralino.config.json`) and CLI tool (`@neutralinojs/neu`) are removed.
- **Scripts and CI**:
  - `package.json` scripts (`native:dev`, `native:build`, `native:preview`) updated to build and run the Go shell.
  - Packaging scripts (`scripts/build-streamer.sh`, CI workflows) updated to build the desktop shell binary.

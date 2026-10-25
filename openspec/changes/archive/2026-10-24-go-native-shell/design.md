# Design

## Context

Drop desktop currently uses Neutralino in "chrome" mode:
1. Neutralino locates Chrome/Chromium and launches it with `--app=https://drop.lzart.com.br`.
2. The web client initializes `@neutralinojs/lib`, connects to Neutralino's WebSocket server on `127.0.0.1`, and invokes `os.execCommand` to launch an extracted Go streamer binary for file transfers.
3. Drop's frontend is cleanly decoupled via `quick-di` ports (`NativeApi`, `PickerPort`, `WatcherPort`, `FileAdapterPort`, `FileReaderPort`, `ReceiveFolderPort`).

By replacing Neutralino with a dedicated Go host executable, we unify the window runner, the native OS services, and the streaming server into a single binary.

## Goals / Non-Goals

**Goals:**
- Provide a single compiled Go binary (`native/desktop/`) replacing both Neutralino and the separate streamer sidecar.
- Launch Chrome in `--app` mode pointing to the remote UI with isolated ephemeral user profiles (reusing the battle-tested pattern from PointTracker).
- Expose an authenticated loopback HTTP/WebSocket server on an ephemeral port.
- Serve JSON-RPC over WebSocket for OS dialogs, filesystem operations, and directory watching.
- Serve high-performance HTTP `/read` and `/write` endpoints for binary file streaming.
- Provide a clean TypeScript adapter layer implementing `NativeApi`, `PickerPort`, and `WatcherPort`.
- Completely eliminate `@neutralinojs/neu`, `@neutralinojs/lib`, and `neutralino.config.json`.

**Non-Goals:**
- Porting WebRTC (Pion) or signaling to Go in this change (identified in `GOPLAN.md` as an independent future optimization phase).
- Bundling local offline static UI assets (the desktop shell continues loading the hosted origin or local dev URL).
- Adding support for OS targets beyond Windows x64 and Linux x64 in initial release (preserving current packaging matrix).

## Decisions

### 1. Unified Go Native Host Binary
- **Decision**: Combine the Chrome process orchestrator, OS bridge, and byte streamer into a single Go application in `native/desktop/`.
- **Rationale**: Eliminates runtime extraction of binaries to `/tmp`, eliminates stdin bootstrap synchronization, and removes the Neutralino runtime dependency.
- **Alternatives considered**: Keeping a Go launcher and a separate Go streamer sidecar (unnecessary multi-process overhead); adopting Wails/Tauri (heavyweight embedded webview engines incompatible with loading remote HTTPS origins without extensive IPC proxying).

### 2. Chrome Launcher Architecture
- **Decision**: Adapt PointTracker's `chromeCommand` and process supervision model:
  - Detect Chrome/Chromium via standard candidate names (`google-chrome`, `google-chrome-stable`, `chromium`, `chrome.exe`, and `CHROME_BIN` override).
  - Launch with `--app=<target-url>`, `--user-data-dir=<temp-dir>`, and performance/security flags.
  - Automatically pass loopback port and authentication token via URL query parameters (`?dropPort=...&dropToken=...`).
  - Monitor the Chrome process exit and terminate the Go host cleanly.
- **Rationale**: Proven in PointTracker; avoids fragile browser automation protocols like CDP.

### 3. Bootstrap Credential Delivery: URL Launch Parameters
- **Decision**: Pass loopback port and session authentication token exclusively via URL launch query parameters (`?dropPort=<port>&dropToken=<token>`) when executing the Chrome `--app` command. The client bootstrap reads these parameters and immediately removes them from the browser address bar with `history.replaceState()`.
- **Rationale**: URL launch query parameters require zero intermediary filesystem I/O, no stdin pipes between browser and Go, and work seamlessly with remote HTTPS origins without needing custom browser extensions or CDP.
- **Alternatives considered**:
  - *Local auth file (`/tmp/auth.json`)*: Subject to race conditions, orphaned files, and cross-origin file read restrictions in standard browsers.
  - *CDP script evaluation*: Overly fragile and complex for simple credential passing.

### 4. Bridge Protocol: WebSocket JSON-RPC + HTTP Byte Streaming
- **Decision**:
  - **WebSocket (`/bridge`)**: Connects to `ws://127.0.0.1:<dropPort>/bridge?token=<dropToken>` for bidirectional control traffic:
    - RPC calls: `fs.stat`, `fs.readDir`, `fs.mkdir`, `fs.remove`, `fs.rename`, `fs.getDownloadsPath`, `dialog.pickFiles`, `dialog.pickFolder`, `watch.start`, `watch.stop`.
    - Push notifications: `watch.event` (`add`, `unlink`).
  - **HTTP (`/read`, `/write`)**: High-throughput file chunk transfers with Range headers and chunked POST bodies (retaining the existing proven streamer protocol).
- **Rationale**: Low latency and push capabilities for watching events, combined with optimal browser throughput for raw binary streams.

### 5. Native Dialogs via Pure Go
- **Decision**: Use `ncruces/zenity` for native folder and file selection dialogs.
- **Rationale**: Pure Go implementation requiring no Cgo (`CGO_ENABLED=0` compatible), invoking native Win32 dialogs on Windows, NSOpenPanel on macOS, and zenity/portal on Linux.
- **Alternatives considered**: Cgo-based file dialog libraries (break cross-compilation in Docker/CI); HTML file inputs (cannot provide full filesystem paths required for native file streaming).

### 6. In-Host File Settlement for Directory Watching
- **Decision**: Implement directory watching with `fsnotify/fsnotify`, executing the file settlement check (`settledSize` verification until file size stops growing) inside Go before emitting the `add` event to the frontend.
- **Rationale**: Replaces frontend polling across the bridge with in-process Go timers, significantly reducing IPC traffic.

## Risks / Trade-offs

- **[Chrome/Chromium Dependency]** → Chrome or Chromium must be installed on the user's system.
  *Mitigation*: Same prerequisite as Neutralino chrome mode and PointTracker; clear error message if no browser binary is detected.
- **[Private Network Access / CORS Restrictions]** → Remote HTTPS page connecting to `127.0.0.1`.
  *Mitigation*: The Go HTTP server sends `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Private-Network: true`, and supports preflight `OPTIONS` requests (matching existing streamer configuration).
- **[Bootstrap Token Exposure]** → Port and token are passed in the initial URL query parameters.
  *Mitigation*: The SvelteKit client immediately scrubs query parameters from the address bar using `history.replaceState()` during initialization.

## Reference Implementations

The implementation of the Go desktop host directly leverages patterns and code from two reference projects:

1. **`/home/zero/Projects/Others/PointTracker/`**:
   - **Chrome Launcher (`chrome.go`)**: Cross-platform executable discovery (`findChrome`), CLI arguments for app mode (`chromeArguments`), and execution via `exec.Command`.
   - **Ephemeral Profile Lifecycle (`app.go`)**: Creates a temporary directory via `os.MkdirTemp` for `--user-data-dir`, ensures cleanup on exit with `os.RemoveAll`, and supervises `command.Wait()` so that closing the Chrome window cleanly triggers Go server shutdown.
   - **Local Server Lifecycle (`app.go`)**: Binds an ephemeral port with `net.Listen("tcp", "127.0.0.1:0")`, launches the browser pointing to that port, and coordinates graceful HTTP server shutdown with context timeouts.

2. **`/home/zero/Projects/Ours/RegistryUI/`**:
   - **Go Architecture & Composition Root (`main.go`, `run()`)**: Clean composition root pattern with environment loading, dedicated `run()` entrypoint, error propagation to `log.Fatal`, and modular router initialization (`newMux`).
   - **HTTP Server Configuration**: Configures standard library `http.Server` with explicit timeouts (`ReadHeaderTimeout`, `ReadTimeout`, `WriteTimeout`, `IdleTimeout`) and handles `http.ErrServerClosed` cleanly.
   - **Modular Internal Structure (`internal/`)**: Package organization under `internal/` separating configuration (`internal/config`), HTTP transport/handlers (`internal/web`), and core business logic.

## Migration Plan

1. **Go Host (`native/desktop`)**:
   - Implement `main.go`, `chrome.go`, `server.go`, `rpc.go`, `fs.go`, `dialogs.go`, and `watcher.go`.
   - Embed existing `streamer` handlers directly.
2. **TypeScript Adapters (`src/lib/adapters/native/`)**:
   - Implement `goNativeClient.ts`, `goNativeApi.ts`, `goNativePicker.ts`, and `goNativeWatch.ts`.
   - Update `nativeProviders.ts` and `src/hooks.client.ts`.
   - Remove `neutralino*.ts`.
3. **Build & Tooling**:
   - Remove `@neutralinojs/neu`, `@neutralinojs/lib`, and `neutralino.config.json`.
   - Update `package.json` scripts (`native:dev`, `native:build`).
   - Update `scripts/build-cli.sh` and CI packaging to compile `native/desktop`.

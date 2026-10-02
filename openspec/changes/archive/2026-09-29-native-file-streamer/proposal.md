# Proposal

## Why

Native send and receive move file bytes through Neutralino `filesystem.readBinaryFile` and `filesystem.appendBinaryFile`. Both encode the payload as base64 on the framework WebSocket, so the desktop app is much slower than the web app, which streams raw bytes. A local Go extension can stream those bytes over HTTP and leave the WebRTC chunk protocol alone.

## What Changes

- Add a Neutralino extension, written in Go, that listens on `127.0.0.1` with an ephemeral port and streams file bytes: one ranged GET per send, one POST body per receive (append when resuming a partial file).
- Ship extension binaries for linux_x64, windows_x64, and darwin_x64, and start the extension with the Neutralino app (`neu run` and `neu build`).
- When the extension is ready, native disk reads and writes of transfer bytes go through that server and are not base64-encoded. Drop the 4 MiB append batch on that path.
- If the extension is not ready, or a stream request fails, that file falls back to today's base64 Neutralino filesystem calls for the bytes still to be read or written.
- Web transfers stay on the service worker. Neutralino filesystem calls that are not file-byte streaming (move, copy, remove, stats, list, mkdir, watch, folder dialogs, clipboard) stay as they are.
- The local server requires a per-process token announced with the port. It does not serve arbitrary browsers that only know the port.

## Capabilities

### New Capabilities

- `native-file-streamer`: Go Neutralino extension, local read/write HTTP streams, startup handshake, token, packaging for linux/windows/darwin x64, and base64 fallback when the streamer cannot serve a file.

### Modified Capabilities

- `file-transfer`: The native 4 MiB append batch applies only to the base64 fallback. While the streamer is writing a file, accepted bytes are pushed into that file's POST body and are not accumulated into a 4 MiB batch. The 8 MiB credit window, resume, and progress rules stay.

## Impact

- New Go module and three x64 binaries, started from `neutralino.config.json` (`enableExtensions`, `extensions`, `cli.extensionsPath`). `pnpm native:dev` and `pnpm native:build` build the extension before `neu`.
- `src/lib/adapters/native/neutralinoApi.ts`: streamer client for `openWriteStream` / `writeStreamChunk` / `closeWriteStream` / `abortWriteStream` and `readFileChunk`. Existing base64 append path remains the fallback. `FLUSH_THRESHOLD` stays for that fallback only.
- `src/lib/adapters/native/nativeFsFileAdapter.ts` and `src/lib/adapters/native/nativeFileReader.ts`: same ports. Receive still writes a `.drop` file then renames. Send still pulls `maxMessageSize` chunks. They must keep one HTTP body open per file instead of one Neutralino call per chunk.
- `src/lib/adapters/native/neutralinoClient.ts` (or the native startup next to `startNeutralino`): capture `streamerReady` (`port` + token) before the first native transfer IO.
- `src/lib/ports/nativeApi.ts`: no new methods required if the streamer sits behind the current stream and chunk methods.
- Web adapters, WebRTC control messages, and `openspec/specs/file-transfer` credit/resume requirements other than the native batch clause: unchanged.
- No new runtime npm dependency. Go toolchain is a native-build dependency.

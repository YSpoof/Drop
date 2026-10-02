# Tasks

## 1. Go sidecar

- [x] 1.1 Add `extensions/streamer` (`go.mod`, `main.go`, `ws.go`) that reads Neutralino's stdin bootstrap, connects back on the framework WebSocket, listens on `127.0.0.1:0`, and broadcasts `streamerReady` (`port`, `token`). Repeat that broadcast on `streamerAck`. Exit when the socket closes or the socket sends `windowClose`. `GET /read` uses `http.ServeFile`. `POST /write` truncates unless `append=1`, then `io.Copy`s the body. Reject missing or wrong `X-Drop-Token` with 401 and no disk IO. CORS allows `GET`, `POST`, `OPTIONS` and that header. Verify: `CGO_ENABLED=0 go build -o /tmp/streamer-linux_x64 .` from `extensions/streamer` exits 0.
- [x] 1.2 Verify the sidecar contract against the built binary: stdin bootstrap then close, WebSocket `app.broadcast` of `streamerReady`, HTTP 401 without the token, `POST /write` then `GET /read` round-trips the same bytes, a second `POST` without `append=1` replaces the file, `POST` with `append=1` keeps the prefix, a `streamerAck` frame broadcasts `streamerReady` again, and closing the socket exits the process.

## 2. Package the sidecar

- [x] 2.1 Point `neutralino.config.json` at the sidecar: `enableExtensions`, id `br.com.lzart.drop.streamer`, `commandLinux` / `commandDarwin` / `commandWindows` as in `design.md`, `cli.extensionsPath` `/extensions/`, and `cli.extensionsExclude` matching `*.go`, `go.mod`, and `go.sum`. Verify the file still parses as JSON and those fields are present.
- [x] 2.2 Add `pnpm streamer:build` to cross-compile `streamer-linux_x64` and `streamer-win_x64.exe` with `CGO_ENABLED=0` into `extensions/streamer/`. Run it from `native:dev` and `native:build` before `neu`. Gitignore those binaries. Verify `pnpm streamer:build` creates both and `git status` does not list them.

## 3. Native client

- [x] 3.1 Add `src/lib/adapters/native/streamerClient.ts` and, from `startNeutralino` after `init`, subscribe to `streamerReady`, store port and token, and retry `Neutralino.extensions.dispatch` of `streamerAck` until that event arrives. Verify `pnpm check` passes.
- [x] 3.2 Delegate `neutralinoApi` `readFileChunk` to one ranged `GET /read` per sequential cursor (`Range: bytes=<start>-`), cancelled and reopened when the offset jumps. Pull only the requested length from `response.body`. A non-zero start that comes back as HTTP 200 is a stream failure. Verify `pnpm check` passes and the streamer read path does not call `filesystem.readBinaryFile`.
- [x] 3.3 Delegate `openWriteStream` / `writeStreamChunk` / `closeWriteStream` / `abortWriteStream` to one `POST /write` body (`duplex: "half"`), `append=1` only when `start > 0`, awaiting each chunk on the transform writer (no `FLUSH_THRESHOLD` batch on this path). `closeWriteStream` waits for a successful response. `abortWriteStream` aborts the fetch. Leave `move`, `remove`, `fileSize`, and the other metadata methods on the Neutralino filesystem API. Verify `pnpm check` passes and `NativeFsFileAdapter` still calls those same `NativeApi` methods.
- [x] 3.4 Native file bytes have no base64 fallback. If the sidecar is not ready, the send or receive fails. Verify `pnpm check` passes and `neutralinoApi.ts` does not call `appendBinaryFile` or `readBinaryFile`.

## 4. Cancel the read stream

- [x] 4.1 Pass the send `AbortSignal` from `TransferSender.sendFileChunks` through the `readFileChunk` callback (`src/lib/utils/webrtc/protocol.ts`, `src/lib/services/transferService.ts`) into `FileReaderPort.readChunk`. `NativeFileReader` aborts the sidecar GET when the signal aborts. `WebFileReader` accepts the argument and still returns `undefined`. Verify `pnpm check` passes.

## 5. Native integration

- [x] 5.1 Run `pnpm native:dev` and confirm the shell logs a `streamerReady` port. Send and receive a file larger than 8 MiB against a second peer. In the shell's network log, those bytes are `GET /read` and `POST /write` to `127.0.0.1` with raw bodies, and the framework socket is not carrying base64 `filesystem.readBinaryFile` / `filesystem.appendBinaryFile` for that file. Resume a partial receive and confirm the `.drop` prefix is unchanged. Confirm the final name still appears via the existing move, and a browser (non-native) transfer still does not call the sidecar.
- [x] 5.2 With the sidecar not running, confirm a native send or receive fails and does not write the file through `filesystem.appendBinaryFile` or `filesystem.readBinaryFile`.

# Design

## Context

See proposal.md for why. Native transfer bytes go through `neutralinoApi`: `readFileChunk` calls `filesystem.readBinaryFile`, and `writeStreamChunk` base64-encodes up to 4 MiB (`FLUSH_THRESHOLD`) then `filesystem.appendBinaryFile` on the framework socket. `NativeFileReader` and `NativeFsFileAdapter` are the only callers. The WebRTC loop still wants `maxMessageSize` slices on send and a `WritableStream` on receive. Resume still appends a `.drop` file from `startOffset`, then `move` renames it. WebRTC credit rules stay; only the native batch clause in `file-transfer` changes.

`neutralino.config.json` has no `extensions` entry. `cli.extensionsPath` is what `neu` copies next to the packaged binary (`bundler.js`). The shell loads `https://drop.lzart.com.br`, so the page can subscribe to extension events only after that load. `defaultMode` is `chrome`. Chrome will not upload a streamed request body to an HTTP/1.1 server.

## Goals / Non-Goals

**Goals:**

- One raw HTTP body per file for native send and receive, behind the current `NativeApi` methods.
- Native file bytes go only through the sidecar. A missing sidecar fails the transfer.
- Sidecar handshake survives a late page load.

**Non-Goals:**

- Moving `move`, `remove`, `listDir`, `ensureDir`, `fileSize`, `pathExists`, watchers, folder dialogs, or clipboard onto the sidecar.
- Changing `SwFileAdapter`, the WebRTC control messages, or the 8 MiB window size.
- macOS builds. Linux x64 and Windows x64 only.
- New automated tests.
- A directory jail. The token is the gate; paths stay whatever the app already passes (picked files and the receive folder).

## Decisions

### Sidecar is a Neutralino extension

Go module at `extensions/streamer`. Neutralino starts it and the process speaks newline-delimited JSON on stdout/stdin, same shape as the sample: `{ "id", "event", "data" }`.

`neutralino.config.json`:

- `enableExtensions: true`
- extension id `br.com.lzart.drop.streamer`
- `commandLinux`: `${NL_PATH}/extensions/streamer/streamer-linux_x64`
- `commandWindows`: `${NL_PATH}/extensions/streamer/streamer-win_x64.exe`
- `cli.extensionsPath`: `/extensions/`
- `cli.extensionsExclude`: Go source (`*.go`, `go.mod`, `go.sum`) so the bundle keeps the binaries

Listen `127.0.0.1:0`. Exit when the framework socket closes, or when it sends `windowClose`. Build with `CGO_ENABLED=0`.

Alternative: a Node extension. The sample's hot path is `io.Copy` and `ServeFile`. Go is the implementation the request asks for. Rejected Node.

Alternative: spawn the binary from the page with `os.execCommand`. That process is not tied to the shell lifecycle as cleanly, and `neu build` would not treat it as an extension. Rejected.

### Handshake retries until the page acks

Neutralino 6 writes one JSON object to the sidecar stdin (`nlPort`, `nlToken`, `nlConnectToken`, `nlExtensionId`) and then closes stdin. That close is startup, not shutdown. The sidecar connects to `ws://127.0.0.1:{nlPort}?extensionId={id}&connectToken={connectToken}` and stays up until that socket closes.

It announces itself with `app.broadcast` of `streamerReady` and `{ port, token }`. It does that again when the socket receives `streamerAck`. After `Neutralino.init`, the page subscribes to `streamerReady`, stores port and token, then `Neutralino.extensions.dispatch("br.com.lzart.drop.streamer", "streamerAck", {})`. Retry the dispatch until a ready event arrives. A broadcast sent before the remote page subscribes is lost. Stdout JSON lines are not the extension channel.

Token is `crypto/rand` (32 bytes, hex), not a query parameter. Clients send `X-Drop-Token`. Compare in constant time. Missing or wrong token: 401 and no disk IO. CORS allows `GET`, `POST`, `OPTIONS` and the token header so the webview's preflight succeeds. Origin `*` is acceptable only because the token is required.

### One GET per send, consumed in existing chunks

`readFileChunk` keeps its signature. For a sequential read it opens `GET /read?path=` with `Range: bytes=<start>-` and `X-Drop-Token`, then pulls `length` bytes from `response.body`. The next call at the cursor keeps that reader. Any other offset cancels it and opens a new range. `http.ServeFile` already honors `Range`. A 200 when the start was not 0 is a failed stream, not a silent read from byte 0.

Thread the send `AbortSignal` from `TransferSender.sendFileChunks` through the `readFileChunk` callback so a cancelled send aborts the GET. Without that, a cancelled multi-gigabyte `ServeFile` stays stuck on a socket nobody reads. Web and the service-worker reader ignore the signal.

Do not buffer the file. One chunk is pulled, returned, and the rest stays in the HTTP body.

### One POST per receive, no 4 MiB batch

`openWriteStream(path, 0)` POSTs each chunk to `/write?path=` with a `Uint8Array` body, so Chrome sends `Content-Length` over HTTP/1.1. A `ReadableStream` body makes Chrome demand HTTP/2 and fail with `ERR_ALPN_NEGOTIATION_FAILED` against this server. The first POST truncates (`os.Create`). Later POSTs, and every POST when `start > 0`, use `append=1` (`O_WRONLY|O_CREATE|O_APPEND`). Today's assumption stays: a non-zero start equals the current `.drop` size. A close with no chunks still POSTs an empty body so an empty file is created.

`writeStreamChunk` awaits that POST. The chunk is on disk before the write resolves. `NativeFsFileAdapter.write` already awaits `writeStreamChunk`, so credit still means the chunk was accepted onto disk.

`closeWriteStream` closes the writer and awaits the HTTP response. Non-OK rejects. `abortWriteStream` aborts the fetch. Discard still `remove`s the `.drop` file in the adapter; any other abort leaves the bytes `io.Copy` already wrote. The adapter's `move` after a successful close stays on `filesystem.move`.

### The sidecar is required

`openWriteStream` and `readFileChunk` wait for `streamerReady`. If it does not arrive, they throw. There is no `appendBinaryFile` / `readBinaryFile` path for transfer bytes. A failed stream fails that transfer.

### Where the client lives

New `src/lib/adapters/native/streamerClient.ts` owns the ready state, the read-body map, and the POST bodies. `neutralinoApi.ts` delegates `openWriteStream`, `writeStreamChunk`, `closeWriteStream`, `abortWriteStream`, and `readFileChunk`. `startNeutralino` subscribes and dispatches `streamerAck` after `init`. Ports stay. Web providers stay.

`readFileChunk`'s callback in `src/lib/utils/webrtc/protocol.ts` and the wiring in `src/lib/services/transferService.ts` gain an `AbortSignal` argument. `WebFileReader.readChunk` can ignore it.

### Build

`pnpm streamer:build` cross-compiles two binaries into `extensions/streamer/`:

- `GOOS=linux GOARCH=amd64` → `streamer-linux_x64`
- `GOOS=windows GOARCH=amd64` → `streamer-win_x64.exe`

`native:dev` and `native:build` run that first, then `neu run` / `neu build --release --embed-resources`. Binaries are gitignored. Go on `PATH` is required for those scripts. A linux `neu build` still only packages the Neutralino linux binary; the extensions directory it copies contains both sidecar binaries, and each OS command launches its own.

## Risks / Trade-offs

- [Ready event fires before the remote page subscribes] → Resend on `streamerAck`; page retries dispatch.
- [`neu run` resolves `${NL_PATH}` somewhere other than the project root] → Check on first native run; fix the command prefix if the binary is not found. Packaged builds copy `cli.extensionsPath` beside the executable, where `${NL_PATH}` is that directory.
- [POST dies after a partial chunk] → The transfer fails. Bytes already written stay in the `.drop` file for a later resume. No base64 rewrite.
- [Sidecar missing] → The transfer fails with `File streamer is not running`.
- [Token sits in the renderer] → Do not log it. 401 without disk IO if it leaks to another origin that also learns the port.
- [Windows binary inside a linux bundle] → Simpler than filtering per host.

## Migration Plan

No on-disk format change. Existing `.drop` files still resume by size. Deploy is a new native build; the web deploy does not include the sidecar. Rollback is a native build without this client. A build whose sidecar does not start cannot finish native transfers.

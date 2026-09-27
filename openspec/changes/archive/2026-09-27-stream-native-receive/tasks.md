# Tasks

## 1. Credit control message

- [x] 1.1 Add `CreditMessage` `{ type: "credit"; fileId: string; bytesWritten: number }` to the `ControlMessage` union in `src/lib/utils/webrtc/protocol.ts`. Add a `describeControlMessage` case that returns `credit fileId=<id> offset=<bytesWritten>`. Verify the union member and that case text are present, and `pnpm check` passes.

## 2. Receiver confirms after the stream write

- [x] 2.1 On `ReceiveState`, remember the last credited offset, starting at the resume-aligned `receivedBytes` once the stream is open. After every successful `applyChunkBytes` (live `processBinaryChunk` path and the `pendingChunks` replay in `beginReceive`), send `{ type: "credit", fileId, bytesWritten: receivedBytes }` when bytes accepted since the last credit are at least 1 MiB, or when `receivedBytes >= meta.size`. Send on that same turn, only after `write()` has resolved. Do not send from `handleBinaryChunk`. Verify the only `credit` sends sit after `applyChunkBytes`, both thresholds are in that path, and `handleBinaryChunk` sends no control message.

## 3. Sender window and progress

- [x] 3.1 On the current send, keep `bytesConfirmed`. In `beginSend`, set it from the resume offset before `sendFileChunks`. Add `onCredit(fileId, bytesWritten)`: ignore a different file id or an offset below `bytesConfirmed`; otherwise raise `bytesConfirmed`. When the offset is below `queued.file.size` and this send is still current, emit in-progress sender progress at that offset. When the offset is the file size, update `bytesConfirmed` only. Verify a full-size credit does not emit progress at the file size, and `onAck` remains the only `completed` emit at `queued.file.size`.

- [x] 3.2 In `sendFileChunks`, before each `files.send`, wait while `bytesSent - bytesConfirmed + chunkSize` would exceed `8 * 1024 * 1024`. Wait with `Promise.withResolvers`, settled by `onCredit` or by the send `AbortSignal` / `shouldStopSend` (cancel, session abort, download-aborted). On that stop, return without sending further bytes of the file. Remove the per-chunk `emitQueuedProgress` that passes `bytesSent`. Verify the loop no longer reports `bytesSent`, the wait uses `Promise.withResolvers`, and the cap is `8 * 1024 * 1024`.

## 4. Dispatch

- [x] 4.1 In `TransferManager.handleControlMessage`, handle `type: "credit"` by calling `sender.onCredit(fileId, bytesWritten)`. Verify the switch has that case and `pnpm check` passes.

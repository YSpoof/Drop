# Design

## Context

See proposal.md for why. Today `TransferSender.sendFileChunks` pushes every slice through `Channel.send` and reports `bytesSent`. fastrtc already waits on SCTP `bufferedAmount`, but the receiver's file-channel `message` handler returns immediately: `TransferReceiver.handleBinaryChunk` appends the `ArrayBuffer` to `chunkWriteQueue` and does not wait for `streamWriter.write`. The data channel therefore stays drained, the sender runs to the end of the file, and the native heap holds every chunk until Neutralino catches up.

`neutralinoApi.writeStreamChunk` is not that buffer. It keeps `chunks` only until `pending` hits `FLUSH_THRESHOLD` (4 MiB), then `appendBinaryFile` and clears the list. `NativeFsFileAdapter` awaits that call from the writable stream. The unbounded retain is the receive queue in front of that write.

Control and file data use separate channels. The sender already waits for `resume` before the first byte, and the receiver sets `sessionOpen` before sending `resume`, so the happy path does not depend on `pendingChunks` or `preReceiveChunks` to hold the file.

## Goals / Non-Goals

**Goals:**

- Pace the sender on receiver accept, with a hard 8 MiB unconfirmed cap.
- Drive in-progress send progress from that confirmed offset.
- Leave the 4 MiB native append batch in place.

**Non-Goals:**

- Changing `SwFileAdapter`. Its `write()` resolves on `postMessage`, so a web receiver confirms as soon as the chunk is handed to the service worker. The service-worker `pending` list is unchanged.
- Replacing fastrtc or tuning SCTP watermarks. Application credit is required because the browser delivers data-channel messages; the app cannot leave them unread.
- New tests.

## Decisions

### Credit is an absolute offset on the control channel

Add `credit` to `ControlMessage`: `{ type: "credit", fileId: string, bytesWritten: number }`. `bytesWritten` is the absolute file offset the stream write has accepted (`ReceiveState.receivedBytes` after `applyChunkBytes`). The sender stores the high-water mark for the current file and ignores a lower offset or a different `fileId`.

The receiver sends `credit` from the same serial `chunkWriteQueue` turn that finished the write, so a credit never overtakes the bytes it names. Coalesce: send when newly accepted bytes since the last credit reach 1 MiB, and always send when the accepted offset reaches the file size so the window can drain. A 1 MiB coalesce lags progress by at most that much and keeps control traffic off the per-chunk rate (`maxMessageSize`, 64 KiB).

Alternative: one credit per chunk. Correct, and noisy on the control channel for a multi-gigabyte file. Rejected.

Alternative: reuse `ack` as the only signal. The sender would still push the whole file, then sit at 100% until `ack`. That matches the bug. Rejected.

### Window is 8 MiB, twice the native flush

`SEND_WINDOW = 8 * 1024 * 1024`. Before each chunk, if `bytesSent - bytesConfirmed + chunkSize` would exceed the window, wait. 8 MiB lets one 4 MiB append run while the next 4 MiB is already queued behind it, so a flush round-trip does not idle the link.

The wait is `Promise.withResolvers`, resolved by `credit` or by the existing send `AbortSignal` / `shouldStopSend` (cancel, abort, download-aborted). No `new Promise`.

Alternative: window equal to 4 MiB. The sender would stall for every flush, with nothing queued behind it. Rejected.

Alternative: unbounded send plus a cosmetic progress cap. The bar would look right and the native heap would still hold the file. Rejected.

### In-progress progress uses the confirmed offset, never the file size

`sendFileChunks` stops passing `bytesSent` to `emitQueuedProgress`. Each applied credit emits `in-progress` with `bytesWritten`. When `bytesWritten >= fileSize`, record it for the window but do not emit that value: `TransferProgress.svelte` turns the bar green at 100%, and `finishReceive` still has to `close()` (tail flush and rename) before `ack`. `onAck` already emits `completed` at `queued.file.size`. A credit for another file, or a credit after `shouldStopSend`, does not emit.

`bytesConfirmed` starts at the resume offset inside `beginSend`, after `resumeSlot` resolves. Bytes below that offset are never sent. An empty file sends no chunks and no credit; `done` and `ack` stay as they are.

### The receive queue is bounded by not sending, not by dropping messages

The file channel cannot pause. `handleBinaryChunk` may still close over an `ArrayBuffer` until `write()` finishes. The sender window is what keeps that set ≤ 8 MiB. Do not add a second copy, and do not buffer credits' worth of chunks in `pendingChunks`. `neutralinoApi` stays on the 4 MiB flush: accepted-but-unflushed bytes are the batch the spec allows on top of the window.

`toArrayBuffer` already copies into the batch. That copy lives only until `flush` finishes and is inside the 4 MiB cap. No change.

## Risks / Trade-offs

- [Mixed-version peer never sends `credit`] → Sender waits until abort. Both sides ship in this change. No version negotiation.
- [Credit coalesce lags the bar by up to 1 MiB] → Accepted. The final full-size credit is not shown as 100%; `ack` is.
- [Web receiver confirms before the browser download drains] → Out of scope. Native `write()` awaits the flush, which is the slow path.
- [Zip receive on web uses the same `write()` hook] → Credits follow zip-entry acceptance. Native never takes the zip path (`hasNativeFs`).

## Migration Plan

No stored data migration. Deploy sender and receiver together. Rollback is reverting the control message and the send-loop wait; in-flight sessions drop on disconnect as they do today.

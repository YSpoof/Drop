# Proposal

## Why

A native receive accepts every file chunk into memory, then writes it to disk slowly through Neutralino. The sender treats “handed to the data channel” as progress, so its bar hits 100% and then waits while the receiver is still walking the file. Large files sit fully in the receiver heap.

## What Changes

- The receiver confirms bytes only after they have been accepted by the download stream (native: the bounded disk-append batch, not an unbounded chunk list).
- The sender keeps only a small window of unconfirmed bytes in flight, so it cannot empty the file into the peer ahead of disk.
- Sender progress follows those confirmations. The bar reaches 100% when the receiver has taken the whole file, not when the local send loop finishes.
- **BREAKING** for a mixed-version peer: a sender waits on receive confirmations. A peer that never sends them stalls the file. Both sides of a session are this app and ship together.
- The existing 4 MiB Neutralino append batch stays. It exists because each native write is a base64 WebSocket round-trip. It is not the whole-file buffer.

## Capabilities

### New Capabilities

- `file-transfer`: Streamed file receive with sender progress tied to bytes the receiver has actually taken, and a bound on how far the sender may run ahead.

### Modified Capabilities

## Impact

- Control protocol in `src/lib/utils/webrtc/protocol.ts` and `src/lib/utils/webrtc/transfer.ts` (new confirmation message).
- Send loop and send progress in `src/lib/utils/webrtc/sender.ts` and `src/lib/utils/webrtc/session.ts`.
- Receive path in `src/lib/utils/webrtc/receiver.ts`: stop retaining every chunk on `chunkWriteQueue` ahead of the stream write.
- Native write path stays in `src/lib/adapters/native/neutralinoApi.ts` (`FLUSH_THRESHOLD`) and `src/lib/adapters/native/nativeFsFileAdapter.ts`. No new dependency.
- Web service-worker downloads are out of scope. `SwFileAdapter` resolves `write()` on `postMessage`, so the browser download buffer is unchanged. The window still applies, but a web receiver grants credit as soon as that `write()` resolves.

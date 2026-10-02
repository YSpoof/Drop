# Proposal

## Why

When the receiver removes a file mid-download, the file gets stuck on the receiver's list and is not being removed (receiver only issue). For the sender, instead of removing the file from the sender's view, the sender's file entry and progress bar should reset as if the file was never sent, allowing it to be sent/downloaded again or cleanly reset without lingering stuck states.

## What Changes

- On the receiver side, removing/dismissing a mid-download file correctly removes/hides it from the receiver's transfer/history list (`dismissReceived` / `onFileDismissed`).
- On the sender side, when receiving `download-aborted`, the sender does **not** remove the file from the sender's view/transfer list, but instead resets the file's progress/status back to initial/pending ("as if never sent").

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `file-transfer`: When a receiver removes a file mid-download, the receiver hides/removes the file locally, while the sender resets the file's transfer state and progress as if never sent.

## Impact

- `src/lib/utils/webrtc/receiver.ts` / `queueService.ts` — receiver-side dismissal cleanup.
- `src/lib/utils/webrtc/sender.ts` (`stopReceiveDownload`) — ensure sender resets file progress/status to pending without removing it from the sender's transfer list.

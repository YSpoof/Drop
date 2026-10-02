# Design

## Context

When a receiver removes a file mid-download, the receiver needs to dismiss/remove it locally (hiding it from the receiver's list). On the sender side, the sender receives `download-aborted` via `stopReceiveDownload` (`sender.ts`). Currently, `stopReceiveDownload` already resets the file progress (`emitQueuedProgress(queued, "pending")`), but due to state desynchronization or store handling, it might get stuck or not properly reset/re-announced.

## Goals / Non-Goals

**Goals:**
- Receiver successfully removes/hides the file from its transfer list upon removal mid-download.
- Sender keeps the file in its transfer list but resets its progress bar / status back to pending ("as if never sent").

**Non-Goals:**
- Removing the file from the sender's view.

## Decisions

**Decision 1: Verify and ensure receiver-side removal and sender-side progress reset.**

- Receiver: Ensure `handleDeleteTransfer` for a received file instantly calls `dismissReceivedFile` and `transferStore.removeTransfer`, invoking `receiver.dismissReceived` which aborts with `"discard"` to delete the `.drop` file immediately on the first click.
- Sender: In `stopReceiveDownload`, ensure `emitQueuedProgress(queued, "pending")` and queue state correctly reset progress to 0 and status to pending without deleting the transfer entry from `transferStore.transfers`.

## Risks / Trade-offs

- [Risk] Sender progress bar not resetting visually. Mitigated by ensuring `emitQueuedProgress` updates the store with status `"pending"` and `bytesTransferred: 0`.
- [Risk] Receiver not removing the item from view. Mitigated by verifying `onFileDismissed` triggers `transferStore.removeTransfer`.

## Migration Plan

None.

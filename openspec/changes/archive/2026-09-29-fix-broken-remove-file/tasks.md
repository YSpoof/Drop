# Tasks

## 1. Receiver removal and sender reset implementation

- [x] 1.1 Verify receiver-side `handleDeleteTransfer` for received files calls `dismissReceivedFile` and `transferStore.removeTransfer` so the file is hidden/removed on the receiver.
- [x] 1.2 Verify sender-side `stopReceiveDownload` resets progress and status to pending (`emitQueuedProgress(queued, "pending", 0)`) while keeping the file visible in the sender's transfer list.
- [x] 1.3 Verify with `rtk tsc` that the module type-checks.
- [x] 1.4 Run existing tests with `rtk vitest` to ensure no regressions.

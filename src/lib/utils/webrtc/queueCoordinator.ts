import { appState } from "#lib/stores/appState.svelte.js";
import type { QueuedFile } from "#lib/utils/files/queue.js";
import { logger } from "#lib/utils/logger.js";
import type { TransferManager } from "#lib/utils/webrtc/transfer.js";

export class QueueCoordinator {
  private notifyDelayTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly getTransferManager: () => TransferManager | null) {}

  addFiles(files: FileList | File[] | { file: File; path: string }[]) {
    const newItems = appState.createAndQueue(files);
    if (newItems.length === 1) {
      const item = newItems[0]!;
      logger.log(`(Queue) +1 file: ${item.path} (${item.file.size}b)`);
    } else if (newItems.length > 1) {
      const root = newItems[0]!.path.split("/")[0];
      logger.log(`(Queue) +${newItems.length} files${newItems[0]?.zip ? " zip" : ""}: ${root}/...`);
    }

    if (appState.connected) {
      appState.promoteToHistory(newItems);
    }

    if (this.notifyDelayTimeout) {
      clearTimeout(this.notifyDelayTimeout);
    }

    this.notifyDelayTimeout = setTimeout(() => {
      this.getTransferManager()?.notifyQueueChanged();
      this.notifyDelayTimeout = null;
    }, 500);
  }

  appendQueuedFiles(items: QueuedFile[]) {
    appState.appendQueue(items);
  }

  notifyQueueChanged() {
    this.getTransferManager()?.notifyQueueChanged();
  }

  clearQueue() {
    for (const item of appState.queue) {
      const transfer = appState.transfers.find((entry) => entry.id === item.id);
      if (
        transfer &&
        transfer.direction === "sent" &&
        (transfer.status === "pending" || transfer.status === "in-progress")
      ) {
        this.getTransferManager()?.cancelFile(item.id);
      }
    }
    appState.queue = [];
    if (this.notifyDelayTimeout) {
      clearTimeout(this.notifyDelayTimeout);
      this.notifyDelayTimeout = null;
    }
  }

  handleDeleteTransfer(fileId: string | string[]) {
    const ids = Array.isArray(fileId) ? fileId : [fileId];
    const transferManager = this.getTransferManager();

    for (const id of ids) {
      const item = appState.transfers.find((entry) => entry.id === id);
      if (!item || item.status === "completed" || item.status === "failed") continue;

      if (item.direction === "received") {
        if (transferManager) {
          transferManager.dismissReceivedFile(id);
        } else {
          appState.removeTransfer(id);
        }
        continue;
      }

      if (transferManager) {
        transferManager.cancelFile(id);
      } else {
        appState.removeFile(id);
      }
    }
  }

  handlePull(fileId: string) {
    const item = appState.transfers.find((entry) => entry.id === fileId);
    if (!item || item.status !== "pending") return;

    this.markTransfersInProgress([fileId]);
    this.getTransferManager()?.requestPull(fileId);
  }

  handlePullBatch(fileIds: string[], zipFilename?: string) {
    const pendingIds = appState.pendingReceivedIds(fileIds);
    if (!pendingIds.length) return;

    this.markTransfersInProgress(pendingIds);
    this.getTransferManager()?.requestPullBatch(pendingIds, zipFilename);
  }

  destroy() {
    if (this.notifyDelayTimeout) {
      clearTimeout(this.notifyDelayTimeout);
      this.notifyDelayTimeout = null;
    }
  }

  private markTransfersInProgress(ids: string[]) {
    for (const id of ids) {
      const item = appState.transfers.find((entry) => entry.id === id);
      if (!item) continue;
      appState.upsertTransfer({ ...item, status: "in-progress", bytesTransferred: 0 });
    }
  }
}

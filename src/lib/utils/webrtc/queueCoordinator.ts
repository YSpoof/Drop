import { peerStore } from "#lib/stores/peerStore.svelte.js";
import { transferStore } from "#lib/stores/transferStore.svelte.js";
import type { QueuedFile } from "#lib/utils/files/queue.js";
import { logger } from "#lib/utils/logger.js";
import type { TransferManager } from "#lib/utils/webrtc/transfer.js";

export class QueueCoordinator {
  private notifyDelayTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly getTransferManager: () => TransferManager | null) {}

  addFiles(files: FileList | File[] | { file: File; path: string }[]) {
    const newItems = transferStore.createAndQueue(files);
    if (newItems.length === 1) {
      const item = newItems[0]!;
      logger.log(`(Queue) +1 file: ${item.path} (${item.file.size}b)`);
    } else if (newItems.length > 1) {
      const root = newItems[0]!.path.split("/")[0];
      logger.log(`(Queue) +${newItems.length} files${newItems[0]?.zip ? " zip" : ""}: ${root}/...`);
    }

    if (peerStore.connected) {
      transferStore.promoteToHistory(newItems);
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
    transferStore.appendQueue(items);
  }

  notifyQueueChanged() {
    this.getTransferManager()?.notifyQueueChanged();
  }

  clearQueue() {
    for (const item of transferStore.queue) {
      const transfer = transferStore.transfers.find((entry) => entry.id === item.id);
      if (
        transfer &&
        transfer.direction === "sent" &&
        (transfer.status === "pending" || transfer.status === "in-progress")
      ) {
        this.getTransferManager()?.cancelFile(item.id);
      }
    }
    transferStore.queue = [];
    if (this.notifyDelayTimeout) {
      clearTimeout(this.notifyDelayTimeout);
      this.notifyDelayTimeout = null;
    }
  }

  handleDeleteTransfer(fileId: string | string[]) {
    const ids = Array.isArray(fileId) ? fileId : [fileId];
    const transferManager = this.getTransferManager();

    for (const id of ids) {
      const item = transferStore.transfers.find((entry) => entry.id === id);
      if (!item || item.status === "completed" || item.status === "failed") continue;

      if (item.direction === "received") {
        if (transferManager) {
          transferManager.dismissReceivedFile(id);
        } else {
          transferStore.removeTransfer(id);
        }
        continue;
      }

      if (transferManager) {
        transferManager.cancelFile(id);
      } else {
        transferStore.removeFile(id);
      }
    }
  }

  handlePull(fileId: string) {
    const item = transferStore.transfers.find((entry) => entry.id === fileId);
    if (!item || item.status !== "pending") return;

    this.markTransfersInProgress([fileId]);
    this.getTransferManager()?.requestPull(fileId);
  }

  handlePullBatch(fileIds: string[], zipFilename?: string) {
    const pendingIds = transferStore.pendingReceivedIds(fileIds);
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
      const item = transferStore.transfers.find((entry) => entry.id === id);
      if (!item) continue;
      transferStore.upsertTransfer({ ...item, status: "in-progress", bytesTransferred: 0 });
    }
  }
}

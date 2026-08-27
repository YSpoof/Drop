import type { FileReaderPort } from "#lib/ports/fileReader.js";
import type { FileLockManager } from "#lib/services/fileLockManager.js";
import type { FolderWatcher } from "#lib/services/folderWatcher.js";
import { peerStore } from "#lib/stores/peerStore.svelte.js";
import { transferStore } from "#lib/stores/transferStore.svelte.js";
import type { QueuedFile } from "#lib/utils/files/queue.js";
import { logger } from "#lib/utils/logger.js";
import type { TransferManager } from "#lib/utils/webrtc/transfer.js";

export class QueueService {
  private notifyDelayTimeout: ReturnType<typeof setTimeout> | null = null;
  private getTransferManager: () => TransferManager | null = () => null;
  /** groupIds that are folder-watched (so we don't double-lock) */
  private watchedGroupIds = new Set<string>();

  constructor(
    private readonly fileReader: FileReaderPort,
    private readonly lockManager: FileLockManager,
    private readonly folderWatcher: FolderWatcher,
  ) {
    this.folderWatcher.init(
      (groupId, file) => this.addWatchedFile(groupId, file),
      (fileId) => this.removeWatchedFile(fileId),
    );
  }

  bind(getTransferManager: () => TransferManager | null) {
    this.getTransferManager = getTransferManager;
  }

  addFiles(files: FileList | File[] | { file: File; path: string }[]) {
    const newItems = transferStore.createAndQueue(files);
    if (newItems.length === 1) {
      const item = newItems[0]!;
      logger.log(`(Queue) +1 file: ${item.path} (${item.file.size}b)`);
    } else if (newItems.length > 1) {
      const root = newItems[0]!.path.split("/")[0];
      logger.log(`(Queue) +${newItems.length} files: ${root}/...`);
    }

    if (peerStore.connected) {
      transferStore.promoteToHistory(newItems);
    }

    if (newItems.length > 0) {
      const groupId = newItems[0]!.groupId;
      const isFolder = newItems.length > 1 && newItems.some((qf) => qf.path.includes("/"));

      if (isFolder) {
        const firstWithPath = newItems.find((qf) => !!this.fileReader.nativePath(qf.file));
        if (firstWithPath) {
          const absFile = this.fileReader.nativePath(firstWithPath.file);
          const folderRoot = firstWithPath.path.split("/")[0]!;
          const rootIdx = absFile.lastIndexOf(folderRoot);
          const folderPath = absFile.slice(0, rootIdx + folderRoot.length);
          this.watchedGroupIds.add(groupId);
          void this.folderWatcher.watchGroup(groupId, folderPath, newItems);
        }
      } else {
        for (const qf of newItems) {
          const absPath = this.fileReader.nativePath(qf.file);
          if (absPath) void this.lockManager.lock(qf.id, absPath);
        }
      }
    }

    this.scheduleNotify();
  }

  /** Called by FolderWatcher when a new file appears in a watched folder. */
  addWatchedFile(groupId: string, file: QueuedFile) {
    transferStore.appendQueue([file]);
    if (peerStore.connected) transferStore.promoteToHistory([file]);
    this.scheduleNotify();
  }

  /** Called by FolderWatcher when a file is deleted from a watched folder. */
  removeWatchedFile(fileId: string) {
    void this.lockManager.unlock(fileId);
    this.handleDeleteTransfer(fileId);
    this.scheduleNotify();
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
    for (const groupId of this.watchedGroupIds) {
      void this.folderWatcher.unwatchGroup(groupId);
    }
    this.watchedGroupIds.clear();
    void this.lockManager.unlockAll();

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

  reset() {
    if (this.notifyDelayTimeout) {
      clearTimeout(this.notifyDelayTimeout);
      this.notifyDelayTimeout = null;
    }
    for (const groupId of this.watchedGroupIds) {
      void this.folderWatcher.unwatchGroup(groupId);
    }
    this.watchedGroupIds.clear();
    void this.lockManager.unlockAll();
    this.getTransferManager = () => null;
  }

  private markTransfersInProgress(ids: string[]) {
    for (const id of ids) {
      const item = transferStore.transfers.find((entry) => entry.id === id);
      if (!item) continue;
      transferStore.upsertTransfer({ ...item, status: "in-progress", bytesTransferred: 0 });
    }
  }

  private scheduleNotify() {
    if (this.notifyDelayTimeout) clearTimeout(this.notifyDelayTimeout);
    this.notifyDelayTimeout = setTimeout(() => {
      this.getTransferManager()?.notifyQueueChanged();
      this.notifyDelayTimeout = null;
    }, 500);
  }
}

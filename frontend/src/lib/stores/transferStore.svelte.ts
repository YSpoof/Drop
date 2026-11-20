import {
  loadAutoDownload,
  loadReceiveFolderPath,
  saveAutoDownload,
  saveReceiveFolderPath,
} from "#lib/utils/files/prefs.js";
import { createQueuedFiles, type QueuedFile } from "#lib/utils/files/queue.js";
import {
  flushTransferStats,
  loadTransferStats,
  resetTransferStats as persistResetTransferStats,
  scheduleSaveTransferStats,
  type TransferStats,
} from "#lib/utils/files/transferStats.js";
import type { TransferItem } from "#lib/utils/files/transferTypes.js";

const autoDownload = await loadAutoDownload();
const initialReceiveFolderPath = await loadReceiveFolderPath();
const initialTransferStats = await loadTransferStats();

class TransferStore {
  queue = $state<QueuedFile[]>([]);
  transfers = $state<TransferItem[]>([]);
  autoDownload = $state(autoDownload);
  receiveFolderPath = $state(initialReceiveFolderPath);
  transferStats = $state<TransferStats>(initialTransferStats);

  visibleQueue = $derived(
    this.queue.filter(
      (item) => !this.transfers.some((entry) => entry.id === item.id && entry.direction === "sent"),
    ),
  );

  pendingReceived = $derived(
    this.transfers.filter((item) => item.direction === "received" && item.status === "pending"),
  );

  setAutoDownload(value: boolean) {
    this.autoDownload = value;
    void saveAutoDownload(value);
  }

  async setReceiveFolderPath(path: string) {
    this.receiveFolderPath = path;
    await saveReceiveFolderPath(path);
  }

  recordTransferStats(direction: "sent" | "received", bytes: number) {
    const next: TransferStats =
      direction === "sent"
        ? { ...this.transferStats, uploadBytes: this.transferStats.uploadBytes + bytes }
        : { ...this.transferStats, downloadBytes: this.transferStats.downloadBytes + bytes };
    this.transferStats = next;
    scheduleSaveTransferStats(next);
  }

  recordTransferFile(direction: "sent" | "received") {
    const next: TransferStats =
      direction === "sent"
        ? { ...this.transferStats, uploadFiles: this.transferStats.uploadFiles + 1 }
        : { ...this.transferStats, downloadFiles: this.transferStats.downloadFiles + 1 };
    this.transferStats = next;
    scheduleSaveTransferStats(next);
  }

  resetTransferStats() {
    this.transferStats = {
      uploadBytes: 0,
      downloadBytes: 0,
      uploadFiles: 0,
      downloadFiles: 0,
    };
    void flushTransferStats().then(() => persistResetTransferStats());
  }

  upsertTransfer(update: TransferItem) {
    const index = this.transfers.findIndex(
      (item) => item.id === update.id && item.direction === update.direction,
    );
    if (index >= 0) {
      this.transfers = this.transfers.with(index, { ...this.transfers[index]!, ...update });
    } else {
      this.transfers = [update, ...this.transfers];
    }
  }

  promoteToHistory(items: QueuedFile[]) {
    for (const item of items) {
      this.upsertTransfer({
        id: item.id,
        name: item.path,
        size: item.file.size,
        direction: "sent",
        status: "pending",
        bytesTransferred: 0,
      });
    }
  }

  appendQueue(items: QueuedFile[]) {
    this.queue = [...this.queue, ...items];
  }

  removeFile(id: string | string[]) {
    const ids = Array.isArray(id) ? new Set(id) : new Set([id]);
    this.queue = this.queue.filter((item) => !ids.has(item.id));
    this.transfers = this.transfers.filter((item) => !ids.has(item.id));
  }

  /** Takes a sent file out of the send queue; its history row stays. */
  dequeue(id: string) {
    this.queue = this.queue.filter((item) => item.id !== id);
  }

  removeTransfer(id: string | string[]) {
    const ids = Array.isArray(id) ? new Set(id) : new Set([id]);
    this.transfers = this.transfers.filter((item) => !ids.has(item.id));
  }

  pendingReceivedIds(ids: string[]) {
    const idSet = new Set(ids);
    return this.pendingReceived.filter((item) => idSet.has(item.id)).map((item) => item.id);
  }

  /** Peer loss: drops received rows, keeps finished sent rows, and puts queued ones back to pending. */
  resetTransferState() {
    const queueIds = new Set(this.queue.map((item) => item.id));
    this.transfers = this.transfers.flatMap((item): TransferItem[] => {
      if (item.direction !== "sent") return [];
      if (item.status === "completed" || item.status === "failed") return [item];
      if (!queueIds.has(item.id)) return [];
      return [{ ...item, status: "pending", bytesTransferred: 0 }];
    });
  }

  createAndQueue(files: FileList | File[] | { file: File; path: string }[]) {
    const newItems = createQueuedFiles(files);
    this.appendQueue(newItems);
    return newItems;
  }
}

export const transferStore = new TransferStore();

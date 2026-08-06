import { loadAutoDownload } from "$lib/utils/files/prefs";
import { createQueuedFiles, type QueuedFile } from "$lib/utils/files/queue";
import {
  flushTransferStats,
  loadTransferStats,
  resetTransferStats as persistResetTransferStats,
  scheduleSaveTransferStats,
  type TransferStats,
} from "$lib/utils/files/transferStats";
import type { TransferItem } from "$lib/utils/files/transferTypes";

const autoDownload = await loadAutoDownload();
const initialTransferStats = await loadTransferStats();

class TransferStore {
  queue = $state<QueuedFile[]>([]);
  transfers = $state<TransferItem[]>([]);
  autoDownload = $state(autoDownload);
  transferStats = $state<TransferStats>(initialTransferStats);

  visibleQueue = $derived(
    this.queue.filter(
      (item) => !this.transfers.some((entry) => entry.id === item.id && entry.direction === "sent"),
    ),
  );

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
    const index = this.transfers.findIndex((item) => item.id === update.id);
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

  removeTransfer(id: string | string[]) {
    const ids = Array.isArray(id) ? new Set(id) : new Set([id]);
    this.transfers = this.transfers.filter((item) => !ids.has(item.id));
  }

  pendingReceivedIds(ids: string[]) {
    const idSet = new Set(ids);
    return this.transfers
      .filter(
        (item) => idSet.has(item.id) && item.direction === "received" && item.status === "pending",
      )
      .map((item) => item.id);
  }

  resetTransferState() {
    const queueIds = new Set(this.queue.map((item) => item.id));
    this.transfers = this.transfers
      .filter((item) => item.direction === "sent" && queueIds.has(item.id))
      .map((item) => ({ ...item, status: "pending" as const, bytesTransferred: 0 }));
  }

  createAndQueue(files: FileList | File[] | { file: File; path: string }[]) {
    const newItems = createQueuedFiles(files);
    this.appendQueue(newItems);
    return newItems;
  }
}

export const transferStore = new TransferStore();

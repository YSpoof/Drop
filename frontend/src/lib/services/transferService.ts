import { inject } from "quick-di";

import { FileReaderPort } from "#lib/ports/fileReader.js";
import { DownloadService } from "#lib/services/downloadService.js";
import { toastStore } from "#lib/stores/toast.svelte.js";
import { transferStore } from "#lib/stores/transferStore.svelte.js";
import { Engine } from "#lib/transfer/engine.js";
import { fileIdentity } from "#lib/transfer/protocol.js";
import type { Hooks, Outgoing, Source } from "#lib/transfer/types.js";
import type { BatchDoneInfo, HistoryEntry } from "#lib/utils/files/transferTypes.js";
import type { PeerLink } from "#lib/utils/webrtc/link.js";

type PendingBatchCompletion = {
  direction: HistoryEntry["direction"];
  succeeded: string[];
  fileCountInBatch: number;
};

/** Connects the transfer engine to the app: the send queue, the stores and the toasts. */
export class TransferService {
  private readonly fileReader = inject(FileReaderPort);
  private readonly downloads = inject(DownloadService);
  private pendingBatchCompletions = new Map<string, PendingBatchCompletion>();

  /** The engine for a freshly opened peer link. */
  start(link: PeerLink, onBye: () => void): Engine {
    const engine = new Engine({
      link,
      source: this.source,
      sink: this.downloads,
      hooks: this.hooks(onBye),
      manual: !transferStore.autoDownload,
    });
    link.attach(engine);
    return engine;
  }

  clearPendingBatchCompletions() {
    this.pendingBatchCompletions.clear();
  }

  private readonly source: Source = {
    list: () =>
      transferStore.queue.map(({ id, path, file }): Outgoing => ({
        id,
        name: path,
        size: file.size,
        mime: file.type || "application/octet-stream",
        hash: fileIdentity(path, file.size, file.lastModified),
      })),
    read: async (item, offset, length, signal) => {
      const file = transferStore.queue.find((queued) => queued.id === item.id)?.file;
      if (!file) throw new Error("File removed from the queue");
      const buffer =
        (await this.fileReader.readChunk(file, offset, length, signal)) ??
        (await file.slice(offset, offset + length).arrayBuffer());
      return new Uint8Array(buffer);
    },
  };

  private hooks(onBye: () => void): Hooks {
    return {
      progress: (row) => transferStore.upsertTransfer(row),
      bytes: (direction, count) => transferStore.recordTransferStats(direction, count),
      finished: (entry) => this.upsertFromHistory(entry),
      batchDone: (info) => this.handleBatchDoneToast(info),
      removed: (fileId) => transferStore.removeFile(fileId),
      error: (message) => toastStore.showToast(message, "error"),
      bye: onBye,
    };
  }

  private upsertFromHistory(entry: HistoryEntry) {
    transferStore.upsertTransfer({
      id: entry.id,
      name: entry.name,
      size: entry.size,
      direction: entry.direction,
      status: entry.status === "failed" ? "failed" : "completed",
      bytesTransferred: entry.size,
    });
    // A finished send never goes out again, also not after a reconnect.
    if (entry.direction === "sent") transferStore.dequeue(entry.id);
    if (entry.status !== "failed") transferStore.recordTransferFile(entry.direction);
    this.handleHistoryToast(entry);
  }

  private handleHistoryToast(entry: HistoryEntry) {
    if (entry.status === "failed") {
      toastStore.showToast(`Falha ao transferir: ${entry.name}`, "error");
      return;
    }

    if (!entry.batchId) {
      const action = entry.direction === "sent" ? "enviado" : "recebido";
      toastStore.showToast(`Arquivo ${action}: ${entry.name}`, "success");
      return;
    }

    let batch = this.pendingBatchCompletions.get(entry.batchId);
    if (!batch) {
      batch = {
        direction: entry.direction,
        succeeded: [],
        fileCountInBatch: entry.fileCountInBatch ?? 1,
      };
      this.pendingBatchCompletions.set(entry.batchId, batch);
    }

    batch.succeeded.push(entry.name);
    if (entry.fileCountInBatch) {
      batch.fileCountInBatch = Math.max(batch.fileCountInBatch, entry.fileCountInBatch);
    }
  }

  private handleBatchDoneToast(info: BatchDoneInfo) {
    const batch = this.pendingBatchCompletions.get(info.batchId);
    if (!batch) return;
    this.pendingBatchCompletions.delete(info.batchId);

    const count = batch.succeeded.length;
    if (count === 0) return;

    if (info.direction === "received" && info.fileCountInBatch >= 2) {
      toastStore.showToast(`${count} arquivos baixados.`, "success");
    } else if (info.fileCountInBatch < 2) {
      const action = info.direction === "sent" ? "enviado" : "recebido";
      toastStore.showToast(`Arquivo ${action}: ${batch.succeeded[0]}`, "success");
    } else {
      toastStore.showToast(`${count} arquivos enviados`, "success");
    }
  }
}

import type { Channel } from "fastrtc";

import type { EnvironmentPort } from "#lib/ports/environment.js";
import type { FileReaderPort } from "#lib/ports/fileReader.js";
import type { DownloadService } from "#lib/services/downloadService.js";
import { toastStore } from "#lib/stores/toast.svelte.js";
import { transferStore } from "#lib/stores/transferStore.svelte.js";
import type { QueuedFile } from "#lib/utils/files/queue.js";
import type { BatchDoneInfo, HistoryEntry } from "#lib/utils/files/transferTypes.js";
import type { TransferCallbacks, TransferProgress } from "#lib/utils/webrtc/protocol.js";
import { TransferManager } from "#lib/utils/webrtc/transfer.js";

type PendingBatchCompletion = {
  direction: HistoryEntry["direction"];
  succeeded: string[];
  fileCountInBatch: number;
};

export class TransferService {
  private pendingBatchCompletions = new Map<string, PendingBatchCompletion>();

  constructor(
    private readonly fileReader: FileReaderPort,
    private readonly downloads: DownloadService,
    private readonly environment: EnvironmentPort,
  ) {}

  clearPendingBatchCompletions() {
    this.pendingBatchCompletions.clear();
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

    const count = batch.succeeded.length;
    if (count === 0) {
      this.pendingBatchCompletions.delete(info.batchId);
      return;
    }

    if (info.fileCountInBatch < 2) {
      const action = info.direction === "sent" ? "enviado" : "recebido";
      toastStore.showToast(`Arquivo ${action}: ${batch.succeeded[0]}`, "success");
    } else {
      const action = info.direction === "sent" ? "enviados" : "recebidos";
      toastStore.showToast(`${count} arquivos ${action}`, "success");
    }

    this.pendingBatchCompletions.delete(info.batchId);
  }

  private upsertFromProgress(progress: TransferProgress) {
    const status =
      progress.status ??
      (progress.bytesTransferred >= progress.fileSize ? "completed" : "in-progress");
    transferStore.upsertTransfer({
      id: progress.fileId,
      name: progress.fileName,
      size: progress.fileSize,
      direction: progress.direction === "send" ? "sent" : "received",
      status,
      bytesTransferred: progress.bytesTransferred,
    });
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

    if (entry.status !== "failed") {
      transferStore.recordTransferFile(entry.direction);
    }

    this.handleHistoryToast(entry);
  }

  createTransferCallbacks(options: {
    getSendQueue: () => QueuedFile[];
    onBye: () => void;
    onFileSent?: (fileId: string) => void;
    onFileCancelled?: (fileId: string) => void;
  }): TransferCallbacks {
    return {
      getSendQueue: options.getSendQueue,
      onBye: options.onBye,
      onChunkBytes: (direction, bytes) => {
        transferStore.recordTransferStats(direction === "send" ? "sent" : "received", bytes);
      },
      onProgress: (progress) => this.upsertFromProgress(progress),
      onHistory: (entry) => {
        this.upsertFromHistory(entry);
        if (entry.direction === "sent" && entry.status !== "failed") {
          options.onFileSent?.(entry.id);
        }
      },
      onBatchDone: (info) => this.handleBatchDoneToast(info),
      onFileCancelled: (fileId) => {
        transferStore.removeFile(fileId);
        options.onFileCancelled?.(fileId);
      },
      onFileDismissed: (fileId) => transferStore.removeTransfer(fileId),
      onDownloadError: (message) => {
        toastStore.showToast(message, "error");
      },
      readFileChunk: this.environment.hasNativeFs
        ? (file, start, length) => this.fileReader.readChunk(file.file, start, length)
        : undefined,
    };
  }

  /**
   * Wires up transfer channels after WebRTC connect: create manager, start.
   */
  startTransferManager(
    control: Channel,
    files: Channel,
    onBye: () => void,
    onFileSent?: (fileId: string) => void,
    onFileCancelled?: (fileId: string) => void,
  ): TransferManager {
    const transferManager = new TransferManager(
      control,
      files,
      this.createTransferCallbacks({
        getSendQueue: () => transferStore.queue,
        onBye,
        onFileSent,
        onFileCancelled,
      }),
      this.downloads,
      this.environment,
    );

    transferManager.setManualDownload(!transferStore.autoDownload);
    transferManager.start();
    if (transferStore.queue.length) {
      transferStore.promoteToHistory(transferStore.queue);
    }
    transferManager.notifyQueueChanged();
    return transferManager;
  }
}

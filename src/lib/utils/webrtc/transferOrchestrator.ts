import { toastStore } from "#lib/stores/toast.svelte.js";
import { transferStore } from "#lib/stores/transferStore.svelte.js";
import type { QueuedFile } from "#lib/utils/files/queue.js";
import type { BatchDoneInfo, HistoryEntry } from "#lib/utils/files/transferTypes.js";
import { resolveChunkSize } from "#lib/utils/webrtc/chunkSize.js";
import { PeerConnection } from "#lib/utils/webrtc/peer.js";
import {
  TransferManager,
  type TransferCallbacks,
  type TransferProgress as TransferProgressState,
} from "#lib/utils/webrtc/transfer.js";

type PendingBatchCompletion = {
  direction: HistoryEntry["direction"];
  succeeded: string[];
  fileCountInBatch: number;
};

export class TransferOrchestrator {
  private pendingBatchCompletions = new Map<string, PendingBatchCompletion>();

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

  private upsertFromProgress(progress: TransferProgressState) {
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
    isOfferer: boolean;
    getSendQueue: () => QueuedFile[];
    onBye: () => void;
  }): TransferCallbacks {
    return {
      isOfferer: options.isOfferer,
      getSendQueue: options.getSendQueue,
      onBye: options.onBye,
      onChunkBytes: (direction, bytes) => {
        transferStore.recordTransferStats(direction === "send" ? "sent" : "received", bytes);
      },
      onProgress: (progress) => this.upsertFromProgress(progress),
      onHistory: (entry) => this.upsertFromHistory(entry),
      onBatchDone: (info) => this.handleBatchDoneToast(info),
      onFileCancelled: (fileId) => transferStore.removeFile(fileId),
      onFileDismissed: (fileId) => transferStore.removeTransfer(fileId),
      onDownloadError: (message) => {
        toastStore.showToast(message, "error");
      },
    };
  }

  /**
   * Wires up transfer channels after WebRTC connect: resolve chunk size, create manager, start.
   */
  startTransferManager(
    peer: PeerConnection,
    offerer: boolean,
    onIncompatible: () => void,
    onBye: () => void,
  ): TransferManager | null {
    const { controlChannel: control, filesChannel: files } = peer;

    let chunkSize: number;
    try {
      chunkSize = resolveChunkSize(peer.pc.sctp ?? null);
    } catch {
      onIncompatible();
      return null;
    }

    const transferManager = new TransferManager(
      control,
      files,
      chunkSize,
      this.createTransferCallbacks({
        isOfferer: offerer,
        getSendQueue: () => transferStore.queue,
        onBye,
      }),
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

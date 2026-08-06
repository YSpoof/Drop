import type { QueuedFile } from "$lib/utils/files/queue";
import type { HistoryEntry } from "$lib/utils/files/transferTypes";
import { ZipDownloadSession } from "$lib/utils/files/zipDownload";

import type { DataChannelIo } from "./channelIo";
import {
  type ActiveBatch,
  type FileMeta,
  type TransferCallbacks,
  type TransferProgress,
} from "./protocol";

export interface ReceiveState {
  meta: FileMeta;
  receivedBytes: number;
  pendingChunks: ArrayBuffer[];
  sessionOpen: boolean;
  useZip: boolean;
  senderDone: boolean;
  streamWriter?: WritableStreamDefaultWriter<Uint8Array>;
}

/** Shared mutable session state for sender + receiver + coordinator. */
export class TransferSession {
  receiving = new Map<string, ReceiveState>();
  pendingMetas = new Map<string, FileMeta>();
  sending = false;
  expectingBinary = false;
  currentSendFile: QueuedFile | null = null;
  zipSession: ZipDownloadSession | null = null;
  batchUsesZip = false;
  aborted = false;
  manualDownload: boolean | null = null;
  peerManualDownload = true;
  announcedFiles = new Map<string, QueuedFile>();
  pendingPulls: string[] = [];
  activePullBatch: string[] | null = null;
  activePullBatchFilename?: string;
  pullBatchReceivedCount = 0;
  activeSendBatch: ActiveBatch | null = null;
  activeReceiveBatch: ActiveBatch | null = null;
  chunkWriteQueue = Promise.resolve();
  preReceiveChunks: ArrayBuffer[] = [];
  cancelledFileIds = new Set<string>();
  dismissedReceivedIds = new Set<string>();
  downloadAbortedSendIds = new Set<string>();
  servedFileIds = new Set<string>();
  announcedOrder: string[] = [];

  constructor(
    readonly controlChannel: RTCDataChannel,
    readonly filesChannel: RTCDataChannel,
    readonly callbacks: TransferCallbacks,
    readonly io: DataChannelIo,
    readonly chunkSize: number,
  ) {}

  channelsOpen(): boolean {
    return this.controlChannel.readyState === "open" && this.filesChannel.readyState === "open";
  }

  clearSending() {
    this.sending = false;
    this.currentSendFile = null;
  }

  clearPullBatch() {
    this.activePullBatch = null;
    this.activePullBatchFilename = undefined;
    this.pullBatchReceivedCount = 0;
    this.batchUsesZip = false;
  }

  resetForAbort() {
    this.aborted = true;
    this.receiving.clear();
    this.pendingMetas.clear();
    this.announcedFiles.clear();
    this.announcedOrder = [];
    this.pendingPulls = [];
    this.clearPullBatch();
    this.zipSession = null;
    this.activeSendBatch = null;
    this.activeReceiveBatch = null;
    this.clearSending();
    this.expectingBinary = false;
    this.preReceiveChunks = [];
    this.downloadAbortedSendIds.clear();
    this.servedFileIds.clear();
    this.controlChannel.onmessage = null;
    this.filesChannel.onmessage = null;
  }

  emitProgress(progress: TransferProgress) {
    if (this.cancelledFileIds.has(progress.fileId)) return;
    if (this.dismissedReceivedIds.has(progress.fileId)) return;
    this.callbacks.onProgress?.(progress);
  }

  emitHistory(entry: HistoryEntry) {
    if (this.cancelledFileIds.has(entry.id)) return;
    if (this.dismissedReceivedIds.has(entry.id)) return;
    this.callbacks.onHistory?.(entry);
  }

  emitQueuedProgress(
    queued: QueuedFile,
    status: NonNullable<TransferProgress["status"]>,
    bytesTransferred = 0,
  ) {
    this.emitProgress({
      fileId: queued.id,
      fileName: queued.path,
      fileSize: queued.file.size,
      bytesTransferred,
      direction: "send",
      status,
    });
  }

  emitReceiveProgress(
    meta: FileMeta,
    status: NonNullable<TransferProgress["status"]>,
    bytesTransferred = 0,
  ) {
    this.emitProgress({
      fileId: meta.fileId,
      fileName: meta.name,
      fileSize: meta.size,
      bytesTransferred,
      direction: "receive",
      status,
    });
  }

  emitReceiveHistory(meta: FileMeta, status: "completed" | "failed") {
    this.emitHistory(
      this.withBatchContext({
        id: meta.fileId,
        name: meta.name,
        size: meta.size,
        direction: "received",
        status,
        timestamp: Date.now(),
      }),
    );
  }

  withBatchContext(entry: HistoryEntry): HistoryEntry {
    const batch = entry.direction === "sent" ? this.activeSendBatch : this.activeReceiveBatch;
    if (!batch) return entry;
    return {
      ...entry,
      batchId: batch.id,
      fileCountInBatch: batch.fileCount,
    };
  }

  ensureSendBatch(fileCount: number) {
    if (!this.activeSendBatch) {
      this.activeSendBatch = { id: crypto.randomUUID(), fileCount };
    }
  }

  completeBatch(direction: "sent" | "received") {
    const batch = direction === "sent" ? this.activeSendBatch : this.activeReceiveBatch;
    if (!batch) return;
    this.callbacks.onBatchDone?.({
      batchId: batch.id,
      direction,
      fileCountInBatch: batch.fileCount,
    });
    if (direction === "sent") this.activeSendBatch = null;
    else this.activeReceiveBatch = null;
  }

  completeSendBatch() {
    this.completeBatch("sent");
  }

  completeReceiveBatch() {
    this.completeBatch("received");
  }

  buildFileMeta(queued: QueuedFile): FileMeta {
    const meta: FileMeta = {
      type: "meta",
      fileId: queued.id,
      name: queued.path,
      size: queued.file.size,
      mime: queued.file.type || "application/octet-stream",
    };
    if (queued.zip) meta.zip = true;
    return meta;
  }

  /** Returns true when an in-flight send for `fileId` should stop. */
  shouldStopSend(fileId: string): boolean {
    return (
      this.aborted || this.cancelledFileIds.has(fileId) || this.downloadAbortedSendIds.has(fileId)
    );
  }

  /** Shared chunk loop used by pull-send and auto-send. */
  async sendFileChunks(queued: QueuedFile): Promise<boolean> {
    const totalChunks = Math.ceil(queued.file.size / this.chunkSize);
    let bytesSent = 0;

    for (let index = 0; index < totalChunks; index += 1) {
      if (this.shouldStopSend(queued.id)) {
        this.clearSending();
        return false;
      }
      const offset = index * this.chunkSize;
      const slice = queued.file.slice(offset, offset + this.chunkSize);
      const buffer = await slice.arrayBuffer();
      if (this.shouldStopSend(queued.id)) {
        this.clearSending();
        return false;
      }
      await this.io.sendBuffer(buffer);
      if (this.shouldStopSend(queued.id)) {
        this.clearSending();
        return false;
      }
      this.callbacks.onChunkBytes?.("send", buffer.byteLength);
      bytesSent += buffer.byteLength;
      this.emitQueuedProgress(queued, "in-progress", bytesSent);
    }

    if (this.shouldStopSend(queued.id)) {
      this.clearSending();
      return false;
    }

    await this.io.sendControl({ type: "done", fileId: queued.id });

    this.emitHistory(
      this.withBatchContext({
        id: queued.id,
        name: queued.path,
        size: queued.file.size,
        direction: "sent",
        status: "completed",
        timestamp: Date.now(),
      }),
    );
    return true;
  }
}

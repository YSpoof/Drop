import type { QueuedFile } from "#lib/utils/files/queue.js";
import type { HistoryEntry } from "#lib/utils/files/transferTypes.js";
import { ZipDownloadSession } from "#lib/utils/files/zipDownload.js";

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

/** Sending-side mutable state owned by TransferSender. */
export class SenderState {
  sending = false;
  expectingBinary = false;
  currentSendFile: QueuedFile | null = null;
  zipSession: ZipDownloadSession | null = null;
  batchUsesZip = false;
  announcedFiles = new Map<string, QueuedFile>();
  pendingPulls: string[] = [];
  activePullBatch: string[] | null = null;
  activePullBatchFilename?: string;
  pullBatchReceivedCount = 0;
  activeSendBatch: ActiveBatch | null = null;
  announcedOrder: string[] = [];
  downloadAbortedSendIds = new Set<string>();
  servedFileIds = new Set<string>();

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

  reset() {
    this.clearSending();
    this.expectingBinary = false;
    this.announcedFiles.clear();
    this.announcedOrder = [];
    this.pendingPulls = [];
    this.clearPullBatch();
    this.zipSession = null;
    this.activeSendBatch = null;
    this.downloadAbortedSendIds.clear();
    this.servedFileIds.clear();
  }

  releaseFileTracking(fileId: string) {
    this.downloadAbortedSendIds.delete(fileId);
  }
}

/** Receiving-side mutable state owned by TransferReceiver. */
export class ReceiverState {
  receiving = new Map<string, ReceiveState>();
  pendingMetas = new Map<string, FileMeta>();
  preReceiveChunks: ArrayBuffer[] = [];
  activeReceiveBatch: ActiveBatch | null = null;

  reset() {
    this.receiving.clear();
    this.pendingMetas.clear();
    this.preReceiveChunks = [];
    this.activeReceiveBatch = null;
  }
}

/** Shared mutable session state for sender + receiver + coordinator. */
export class TransferSession {
  readonly sender = new SenderState();
  readonly receiver = new ReceiverState();
  aborted = false;
  manualDownload: boolean | null = null;
  peerManualDownload = true;
  chunkWriteQueue = Promise.resolve();
  cancelledFileIds = new Set<string>();
  dismissedReceivedIds = new Set<string>();

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

  resetForAbort() {
    this.aborted = true;
    this.sender.reset();
    this.receiver.reset();
    this.cancelledFileIds.clear();
    this.dismissedReceivedIds.clear();
    this.controlChannel.onmessage = null;
    this.filesChannel.onmessage = null;
  }

  /** Drop per-file tracking once transfer lifecycle for that id is finished. */
  releaseFileTracking(fileId: string) {
    this.cancelledFileIds.delete(fileId);
    this.dismissedReceivedIds.delete(fileId);
    this.sender.releaseFileTracking(fileId);
  }

  /** Prune tracking sets when no files are in flight. */
  pruneIdleTracking() {
    if (
      this.sender.announcedFiles.size > 0 ||
      this.sender.pendingPulls.length > 0 ||
      this.sender.sending ||
      this.receiver.receiving.size > 0 ||
      this.receiver.pendingMetas.size > 0
    ) {
      return;
    }
    this.cancelledFileIds.clear();
    this.dismissedReceivedIds.clear();
    this.sender.downloadAbortedSendIds.clear();
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
    this.releaseFileTracking(entry.id);
    this.pruneIdleTracking();
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
    const batch =
      entry.direction === "sent" ? this.sender.activeSendBatch : this.receiver.activeReceiveBatch;
    if (!batch) return entry;
    return {
      ...entry,
      batchId: batch.id,
      fileCountInBatch: batch.fileCount,
    };
  }

  ensureSendBatch(fileCount: number) {
    if (!this.sender.activeSendBatch) {
      this.sender.activeSendBatch = { id: crypto.randomUUID(), fileCount };
    }
  }

  completeBatch(direction: "sent" | "received") {
    const batch =
      direction === "sent" ? this.sender.activeSendBatch : this.receiver.activeReceiveBatch;
    if (!batch) return;
    this.callbacks.onBatchDone?.({
      batchId: batch.id,
      direction,
      fileCountInBatch: batch.fileCount,
    });
    if (direction === "sent") this.sender.activeSendBatch = null;
    else this.receiver.activeReceiveBatch = null;
    this.pruneIdleTracking();
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
    const { sender } = this;
    return (
      this.aborted || this.cancelledFileIds.has(fileId) || sender.downloadAbortedSendIds.has(fileId)
    );
  }
}

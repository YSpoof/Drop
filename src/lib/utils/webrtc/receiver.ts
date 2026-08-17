import { createDirectDownloadWriter } from "#lib/utils/files/swDownload.js";
import { DownloadError } from "#lib/utils/files/transferTypes.js";
import { ZipDownloadSession } from "#lib/utils/files/zipDownload.js";

import type { FileMeta } from "./protocol";
import type { TransferSender } from "./sender";
import type { ReceiveState, TransferSession } from "./session";

export class TransferReceiver {
  constructor(
    private readonly session: TransferSession,
    private readonly sender: TransferSender,
  ) {}

  private usesZip(meta: FileMeta): boolean {
    const { session } = this;
    if (session.manualDownload) return session.sender.batchUsesZip;
    return session.sender.batchUsesZip || !!meta.zip;
  }

  private findActiveReceive(): [string, ReceiveState] | undefined {
    return [...this.session.receiver.receiving.entries()].find(
      ([, state]) => state.receivedBytes < state.meta.size,
    );
  }

  private async writeReceivedChunk(state: ReceiveState, data: ArrayBuffer): Promise<void> {
    if (!state.streamWriter) throw new DownloadError("Download stream not ready");
    await state.streamWriter.write(new Uint8Array(data));
  }

  private async applyChunkBytes(state: ReceiveState, data: ArrayBuffer): Promise<void> {
    await this.writeReceivedChunk(state, data);
    const chunkBytes = data.byteLength;
    state.receivedBytes += chunkBytes;
    this.session.callbacks.onChunkBytes?.("receive", chunkBytes);
    if (state.receivedBytes >= state.meta.size) {
      this.session.sender.expectingBinary = false;
    }
  }

  private abortStream(state: ReceiveState) {
    void state.streamWriter?.abort().catch(() => undefined);
  }

  private armReceive(meta: FileMeta) {
    void this.beginReceive(meta);
    this.session.emitReceiveProgress(meta, "in-progress");
  }

  handleBinaryChunk(data: ArrayBuffer) {
    const { session } = this;
    const active = this.findActiveReceive();
    if (!active) return;

    const [, state] = active;

    if (!state.sessionOpen) {
      state.pendingChunks.push(data);
      return;
    }

    session.chunkWriteQueue = session.chunkWriteQueue.then(() => this.processBinaryChunk(data));
  }

  private async processBinaryChunk(data: ArrayBuffer) {
    const { session } = this;
    const active = this.findActiveReceive();
    if (!active) return;

    const [fileId, state] = active;

    try {
      await this.applyChunkBytes(state, data);
    } catch (error) {
      this.failReceive(
        fileId,
        state,
        error instanceof DownloadError ? error.message : "Failed to write received file",
      );
      return;
    }

    session.emitReceiveProgress(state.meta, "in-progress", state.receivedBytes);

    if (state.senderDone && state.receivedBytes >= state.meta.size) {
      await this.finishReceive(fileId);
    }
  }

  onSendDone(fileId: string) {
    const { session } = this;
    const state = session.receiver.receiving.get(fileId);
    if (!state) return;
    state.senderDone = true;
    if (state.receivedBytes === state.meta.size) {
      void this.finishReceive(fileId);
    }
  }

  beginReceive(meta: FileMeta) {
    const { session } = this;
    const sender = session.sender;
    const useZip = this.usesZip(meta);

    const state: ReceiveState = {
      meta,
      receivedBytes: 0,
      pendingChunks: [],
      sessionOpen: false,
      useZip,
      senderDone: false,
    };
    session.receiver.receiving.set(meta.fileId, state);
    sender.expectingBinary = true;

    if (session.receiver.preReceiveChunks.length) {
      state.pendingChunks.push(...session.receiver.preReceiveChunks);
      session.receiver.preReceiveChunks = [];
    }

    session.chunkWriteQueue = session.chunkWriteQueue
      .then(async () => {
        if (useZip) {
          state.streamWriter = await this.getOrCreateZipSession(
            sender.activePullBatchFilename,
          ).openEntry(meta.name, meta.size);
        } else {
          const basename = meta.name.split("/").pop() || meta.name;
          state.streamWriter = await createDirectDownloadWriter(basename, {
            size: meta.size,
            mime: meta.mime,
            onAbort: () => this.abortBrowserDownload(meta.fileId),
          });
        }
        state.sessionOpen = true;

        const buffered = state.pendingChunks;
        state.pendingChunks = [];
        for (const chunk of buffered) {
          await this.applyChunkBytes(state, chunk);
        }

        if (state.receivedBytes > 0) {
          session.emitReceiveProgress(meta, "in-progress", state.receivedBytes);
        }

        if (state.senderDone && state.receivedBytes === state.meta.size) {
          await this.finishReceive(meta.fileId);
        }
      })
      .catch((error) => {
        const current = session.receiver.receiving.get(meta.fileId);
        if (!current) return;
        const message =
          error instanceof DownloadError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Download unavailable for receiving files";
        this.failReceive(meta.fileId, current, message);
      });
  }

  failReceive(fileId: string, state: ReceiveState, message: string) {
    const { session } = this;
    const sender = session.sender;
    if (session.cancelledFileIds.has(fileId)) return;
    if (!session.receiver.receiving.has(fileId)) return;
    if (message === "Download cancelled") {
      this.abortBrowserDownload(fileId);
      return;
    }
    sender.expectingBinary = false;
    void session.io.sendControl({ type: "cancel", fileId });
    session.callbacks.onDownloadError?.(message);
    this.abortStream(state);
    session.receiver.receiving.delete(fileId);
    session.emitReceiveHistory(state.meta, "failed");
    session.emitReceiveProgress(state.meta, "failed", state.receivedBytes);
  }

  async finishReceive(fileId: string) {
    const { session } = this;
    const sender = session.sender;
    const state = session.receiver.receiving.get(fileId);
    if (!state) return;

    if (state.receivedBytes !== state.meta.size) {
      this.failReceive(fileId, state, "Incomplete file received");
      return;
    }

    try {
      await state.streamWriter?.close();
    } catch (error) {
      this.failReceive(
        fileId,
        state,
        error instanceof Error ? error.message : "Failed to finalize download stream",
      );
      return;
    }

    if (
      state.useZip &&
      session.manualDownload &&
      sender.activePullBatch &&
      sender.activePullBatch.length > 1
    ) {
      sender.pullBatchReceivedCount += 1;
      if (sender.pullBatchReceivedCount >= sender.activePullBatch.length) {
        try {
          await sender.zipSession?.finalize();
        } catch (error) {
          this.failReceive(
            fileId,
            state,
            error instanceof Error ? error.message : "Failed to finalize zip download",
          );
          return;
        }
        sender.zipSession = null;
        sender.clearPullBatch();
        session.completeReceiveBatch();
      }
    } else if (!state.useZip && session.manualDownload) {
      session.completeReceiveBatch();
    }

    session.emitReceiveHistory(state.meta, "completed");
    session.receiver.receiving.delete(fileId);
    session.emitReceiveProgress(state.meta, "completed", state.meta.size);

    void session.io.sendControl({ type: "ack", fileId });
    void this.sender.trySendNext();
  }

  private getOrCreateZipSession(filename?: string) {
    const sender = this.session.sender;
    if (!sender.zipSession || sender.zipSession.isFinalized()) {
      sender.zipSession = new ZipDownloadSession(filename, {
        onAbort: () => this.onZipDownloadAborted(),
      });
    }
    return sender.zipSession;
  }

  private onZipDownloadAborted() {
    const { session } = this;
    const sender = session.sender;
    for (const fileId of [...session.receiver.receiving.keys()]) {
      this.abortBrowserDownload(fileId);
    }
    sender.zipSession = null;
    sender.clearPullBatch();
  }

  abortBrowserDownload(fileId: string) {
    const { session } = this;
    const sender = session.sender;
    const state = session.receiver.receiving.get(fileId);

    if (state) {
      this.abortStream(state);
      session.receiver.receiving.delete(fileId);
      session.receiver.pendingMetas.set(fileId, state.meta);

      if (session.receiver.receiving.size === 0) {
        sender.expectingBinary = false;
      }

      session.emitReceiveProgress(state.meta, "pending");
    }

    void session.io.sendControl({ type: "download-aborted", fileId });
  }

  dismissReceived(fileId: string) {
    const { session } = this;
    const sender = session.sender;
    if (session.dismissedReceivedIds.has(fileId)) return;
    session.dismissedReceivedIds.add(fileId);

    session.receiver.pendingMetas.delete(fileId);

    const recvState = session.receiver.receiving.get(fileId);
    if (recvState) {
      this.abortStream(recvState);
      session.receiver.receiving.delete(fileId);

      if (!session.receiver.receiving.size) {
        sender.expectingBinary = false;
      }

      void session.io.sendControl({ type: "download-aborted", fileId });
    }

    session.callbacks.onFileDismissed?.(fileId);
    session.releaseFileTracking(fileId);
    session.pruneIdleTracking();
  }

  async finalizeZipDownload() {
    const sender = this.session.sender;
    if (sender.zipSession && !sender.zipSession.isFinalized()) {
      await sender.zipSession.finalize();
      sender.zipSession = null;
    }

    sender.batchUsesZip = false;
  }

  async cleanupReceives() {
    const { session } = this;
    const sender = session.sender;
    await session.chunkWriteQueue.catch(() => undefined);

    for (const [, state] of session.receiver.receiving) {
      await state.streamWriter?.abort().catch(() => undefined);
    }

    if (sender.zipSession && !sender.zipSession.isFinalized()) {
      await sender.zipSession.finalize().catch(() => undefined);
    }
    sender.zipSession = null;
  }

  requestPull(fileId: string) {
    const { session } = this;
    const sender = session.sender;
    const meta = session.receiver.pendingMetas.get(fileId);
    if (!meta) return;

    session.receiver.pendingMetas.delete(fileId);
    sender.expectingBinary = true;
    sender.activePullBatch = null;
    sender.batchUsesZip = false;
    session.receiver.activeReceiveBatch = { id: crypto.randomUUID(), fileCount: 1 };

    this.armReceive(meta);
    void session.io.sendControl({ type: "pull", fileId });
  }

  requestPullBatch(fileIds: string[], zipFilename?: string) {
    const { session } = this;
    const sender = session.sender;
    const validIds = fileIds.filter((id) => session.receiver.pendingMetas.has(id));
    if (!validIds.length) return;

    sender.activePullBatch = validIds;
    sender.activePullBatchFilename = zipFilename;
    sender.pullBatchReceivedCount = 0;
    sender.batchUsesZip = validIds.length > 1;
    session.receiver.activeReceiveBatch = { id: crypto.randomUUID(), fileCount: validIds.length };

    for (const fileId of validIds) {
      const meta = session.receiver.pendingMetas.get(fileId)!;
      session.receiver.pendingMetas.delete(fileId);
      this.armReceive(meta);
    }

    sender.expectingBinary = true;
    void session.io.sendControl({ type: "pull-batch", fileIds: validIds });
  }

  onMeta(message: FileMeta) {
    const { session } = this;
    if (session.dismissedReceivedIds.has(message.fileId)) return;
    session.receiver.pendingMetas.set(message.fileId, message);

    if (!session.receiver.activeReceiveBatch) {
      session.receiver.activeReceiveBatch = { id: crypto.randomUUID(), fileCount: 0 };
    }
    session.receiver.activeReceiveBatch.fileCount += 1;

    session.emitReceiveProgress(message, "pending");
  }

  onStart(fileId: string) {
    const { session } = this;
    if (session.cancelledFileIds.has(fileId)) return;
    if (session.dismissedReceivedIds.has(fileId)) return;

    const meta = session.receiver.pendingMetas.get(fileId);
    if (!meta) return;

    session.receiver.pendingMetas.delete(fileId);
    this.armReceive(meta);
  }

  onBatchDone() {
    const { session } = this;
    session.chunkWriteQueue = session.chunkWriteQueue.then(async () => {
      if (!session.manualDownload) {
        try {
          await this.finalizeZipDownload();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Download failed";
          session.callbacks.onDownloadError?.(message);
        }
      }
      session.completeReceiveBatch();
    });
  }
}

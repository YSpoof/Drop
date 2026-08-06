import { createDirectDownloadWriter } from "$lib/utils/files/swDownload";
import { DownloadError } from "$lib/utils/files/transferTypes";
import { ZipDownloadSession } from "$lib/utils/files/zipDownload";

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
    if (session.manualDownload) return session.batchUsesZip;
    return session.batchUsesZip || !!meta.zip;
  }

  private findActiveReceive(): [string, ReceiveState] | undefined {
    return [...this.session.receiving.entries()].find(
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
      this.session.expectingBinary = false;
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
    const state = session.receiving.get(fileId);
    if (!state) return;
    state.senderDone = true;
    if (state.receivedBytes === state.meta.size) {
      void this.finishReceive(fileId);
    }
  }

  beginReceive(meta: FileMeta) {
    const { session } = this;
    const useZip = this.usesZip(meta);

    const state: ReceiveState = {
      meta,
      receivedBytes: 0,
      pendingChunks: [],
      sessionOpen: false,
      useZip,
      senderDone: false,
    };
    session.receiving.set(meta.fileId, state);
    session.expectingBinary = true;

    if (session.preReceiveChunks.length) {
      state.pendingChunks.push(...session.preReceiveChunks);
      session.preReceiveChunks = [];
    }

    session.chunkWriteQueue = session.chunkWriteQueue
      .then(async () => {
        if (useZip) {
          state.streamWriter = await this.getOrCreateZipSession(
            session.activePullBatchFilename,
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

        if (state.senderDone && state.receivedBytes === meta.size) {
          await this.finishReceive(meta.fileId);
        }
      })
      .catch((error) => {
        const current = session.receiving.get(meta.fileId);
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
    if (session.cancelledFileIds.has(fileId)) return;
    if (!session.receiving.has(fileId)) return;
    if (message === "Download cancelled") {
      this.abortBrowserDownload(fileId);
      return;
    }
    session.expectingBinary = false;
    void session.io.sendControl({ type: "cancel", fileId });
    session.callbacks.onDownloadError?.(message);
    this.abortStream(state);
    session.receiving.delete(fileId);
    session.emitReceiveHistory(state.meta, "failed");
    session.emitReceiveProgress(state.meta, "failed", state.receivedBytes);
  }

  async finishReceive(fileId: string) {
    const { session } = this;
    const state = session.receiving.get(fileId);
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
      session.activePullBatch &&
      session.activePullBatch.length > 1
    ) {
      session.pullBatchReceivedCount += 1;
      if (session.pullBatchReceivedCount >= session.activePullBatch.length) {
        try {
          await session.zipSession?.finalize();
        } catch (error) {
          this.failReceive(
            fileId,
            state,
            error instanceof Error ? error.message : "Failed to finalize zip download",
          );
          return;
        }
        session.zipSession = null;
        session.clearPullBatch();
        session.completeReceiveBatch();
      }
    } else if (!state.useZip && session.manualDownload) {
      session.completeReceiveBatch();
    }

    session.emitReceiveHistory(state.meta, "completed");
    session.receiving.delete(fileId);
    session.emitReceiveProgress(state.meta, "completed", state.meta.size);

    void session.io.sendControl({ type: "ack", fileId });
    void this.sender.trySendNext();
  }

  private getOrCreateZipSession(filename?: string) {
    const { session } = this;
    if (!session.zipSession || session.zipSession.isFinalized()) {
      session.zipSession = new ZipDownloadSession(filename, {
        onAbort: () => this.onZipDownloadAborted(),
      });
    }
    return session.zipSession;
  }

  private onZipDownloadAborted() {
    const { session } = this;
    for (const fileId of [...session.receiving.keys()]) {
      this.abortBrowserDownload(fileId);
    }
    session.zipSession = null;
    session.clearPullBatch();
  }

  abortBrowserDownload(fileId: string) {
    const { session } = this;
    const state = session.receiving.get(fileId);

    if (state) {
      this.abortStream(state);
      session.receiving.delete(fileId);
      session.pendingMetas.set(fileId, state.meta);

      if (session.receiving.size === 0) {
        session.expectingBinary = false;
      }

      session.emitReceiveProgress(state.meta, "pending");
    }

    void session.io.sendControl({ type: "download-aborted", fileId });
  }

  dismissReceived(fileId: string) {
    const { session } = this;
    if (session.dismissedReceivedIds.has(fileId)) return;
    session.dismissedReceivedIds.add(fileId);

    session.pendingMetas.delete(fileId);

    const recvState = session.receiving.get(fileId);
    if (recvState) {
      this.abortStream(recvState);
      session.receiving.delete(fileId);

      if (!session.receiving.size) {
        session.expectingBinary = false;
      }

      void session.io.sendControl({ type: "download-aborted", fileId });
    }

    session.callbacks.onFileDismissed?.(fileId);
  }

  async finalizeZipDownload() {
    const { session } = this;
    if (session.zipSession && !session.zipSession.isFinalized()) {
      await session.zipSession.finalize();
      session.zipSession = null;
    }

    session.batchUsesZip = false;
  }

  async cleanupReceives() {
    const { session } = this;
    await session.chunkWriteQueue.catch(() => undefined);

    for (const [, state] of session.receiving) {
      await state.streamWriter?.abort().catch(() => undefined);
    }

    if (session.zipSession && !session.zipSession.isFinalized()) {
      await session.zipSession.finalize().catch(() => undefined);
    }
    session.zipSession = null;
  }

  requestPull(fileId: string) {
    const { session } = this;
    const meta = session.pendingMetas.get(fileId);
    if (!meta) return;

    session.pendingMetas.delete(fileId);
    session.expectingBinary = true;
    session.activePullBatch = null;
    session.batchUsesZip = false;
    session.activeReceiveBatch = { id: crypto.randomUUID(), fileCount: 1 };

    this.armReceive(meta);
    void session.io.sendControl({ type: "pull", fileId });
  }

  requestPullBatch(fileIds: string[], zipFilename?: string) {
    const { session } = this;
    const validIds = fileIds.filter((id) => session.pendingMetas.has(id));
    if (!validIds.length) return;

    session.activePullBatch = validIds;
    session.activePullBatchFilename = zipFilename;
    session.pullBatchReceivedCount = 0;
    session.batchUsesZip = validIds.length > 1;
    session.activeReceiveBatch = { id: crypto.randomUUID(), fileCount: validIds.length };

    for (const fileId of validIds) {
      const meta = session.pendingMetas.get(fileId)!;
      session.pendingMetas.delete(fileId);
      this.armReceive(meta);
    }

    session.expectingBinary = true;
    void session.io.sendControl({ type: "pull-batch", fileIds: validIds });
  }

  onMeta(message: FileMeta) {
    const { session } = this;
    if (session.dismissedReceivedIds.has(message.fileId)) return;
    session.pendingMetas.set(message.fileId, message);

    if (!session.activeReceiveBatch) {
      session.activeReceiveBatch = { id: crypto.randomUUID(), fileCount: 0 };
    }
    session.activeReceiveBatch.fileCount += 1;

    session.emitReceiveProgress(message, "pending");
  }

  onStart(fileId: string) {
    const { session } = this;
    if (session.cancelledFileIds.has(fileId)) return;
    if (session.dismissedReceivedIds.has(fileId)) return;

    const meta = session.pendingMetas.get(fileId);
    if (!meta) return;

    session.pendingMetas.delete(fileId);
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

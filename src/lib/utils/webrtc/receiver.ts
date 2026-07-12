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

  private async writeReceivedChunk(state: ReceiveState, data: ArrayBuffer): Promise<void> {
    if (!state.streamWriter) throw new DownloadError("Download stream not ready");
    await state.streamWriter.write(new Uint8Array(data));
  }

  handleBinaryChunk(data: ArrayBuffer) {
    const { session } = this;
    const active = [...session.receiving.entries()].find(
      ([, state]) => state.receivedBytes < state.meta.size,
    );
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
    const active = [...session.receiving.entries()].find(
      ([, state]) => state.receivedBytes < state.meta.size,
    );
    if (!active) return;

    const [fileId, state] = active;
    const chunkBytes = data.byteLength;

    try {
      await this.writeReceivedChunk(state, data);
    } catch (error) {
      this.failReceive(
        fileId,
        state,
        error instanceof DownloadError ? error.message : "Failed to write received file",
      );
      return;
    }

    state.receivedBytes += chunkBytes;
    session.callbacks.onChunkBytes?.("receive", chunkBytes);

    session.emitProgress({
      fileId,
      fileName: state.meta.name,
      fileSize: state.meta.size,
      bytesTransferred: state.receivedBytes,
      direction: "receive",
      status: "in-progress",
    });

    if (state.receivedBytes >= state.meta.size) {
      session.expectingBinary = false;
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
          const chunkBytes = chunk.byteLength;
          await this.writeReceivedChunk(state, chunk);
          state.receivedBytes += chunkBytes;
          session.callbacks.onChunkBytes?.("receive", chunkBytes);
        }

        if (state.receivedBytes > 0) {
          session.emitProgress({
            fileId: meta.fileId,
            fileName: meta.name,
            fileSize: meta.size,
            bytesTransferred: state.receivedBytes,
            direction: "receive",
            status: "in-progress",
          });
        }

        if (state.receivedBytes >= meta.size) {
          session.expectingBinary = false;
        }
      })
      .catch((error) => {
        if (!session.receiving.has(meta.fileId)) return;
        if (session.cancelledFileIds.has(meta.fileId)) return;
        session.receiving.delete(meta.fileId);
        session.expectingBinary = false;
        const message =
          error instanceof DownloadError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Download unavailable for receiving files";
        void session.io.sendControl({ type: "cancel", fileId: meta.fileId });
        session.callbacks.onDownloadError?.(message);
        session.emitHistory(
          session.withBatchContext({
            id: meta.fileId,
            name: meta.name,
            size: meta.size,
            direction: "received",
            status: "failed",
            timestamp: Date.now(),
          }),
        );
        session.emitProgress({
          fileId: meta.fileId,
          fileName: meta.name,
          fileSize: meta.size,
          bytesTransferred: 0,
          direction: "receive",
          status: "failed",
        });
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
    void state.streamWriter?.abort().catch(() => undefined);
    session.receiving.delete(fileId);
    session.emitHistory(
      session.withBatchContext({
        id: fileId,
        name: state.meta.name,
        size: state.meta.size,
        direction: "received",
        status: "failed",
        timestamp: Date.now(),
      }),
    );
    session.emitProgress({
      fileId,
      fileName: state.meta.name,
      fileSize: state.meta.size,
      bytesTransferred: state.receivedBytes,
      direction: "receive",
      status: "failed",
    });
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
        session.activePullBatch = null;
        session.activePullBatchFilename = undefined;
        session.pullBatchReceivedCount = 0;
        session.batchUsesZip = false;
        session.completeReceiveBatch();
      }
    } else if (!state.useZip && session.manualDownload) {
      session.completeReceiveBatch();
    }

    session.emitHistory(
      session.withBatchContext({
        id: fileId,
        name: state.meta.name,
        size: state.meta.size,
        direction: "received",
        status: "completed",
        timestamp: Date.now(),
      }),
    );

    session.receiving.delete(fileId);
    session.emitProgress({
      fileId,
      fileName: state.meta.name,
      fileSize: state.meta.size,
      bytesTransferred: state.meta.size,
      direction: "receive",
      status: "completed",
    });

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
    session.activePullBatch = null;
    session.activePullBatchFilename = undefined;
    session.pullBatchReceivedCount = 0;
    session.batchUsesZip = false;
  }

  abortBrowserDownload(fileId: string) {
    const { session } = this;
    const state = session.receiving.get(fileId);

    if (state) {
      void state.streamWriter?.abort().catch(() => undefined);
      session.receiving.delete(fileId);
      session.pendingMetas.set(fileId, state.meta);

      if (session.receiving.size === 0) {
        session.expectingBinary = false;
      }

      session.emitProgress({
        fileId,
        fileName: state.meta.name,
        fileSize: state.meta.size,
        bytesTransferred: 0,
        direction: "receive",
        status: "pending",
      });
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
      void recvState.streamWriter?.abort().catch(() => undefined);
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

    void this.beginReceive(meta);
    void session.io.sendControl({ type: "pull", fileId });
    session.emitProgress({
      fileId: meta.fileId,
      fileName: meta.name,
      fileSize: meta.size,
      bytesTransferred: 0,
      direction: "receive",
      status: "in-progress",
    });
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
      void this.beginReceive(meta);
      session.emitProgress({
        fileId: meta.fileId,
        fileName: meta.name,
        fileSize: meta.size,
        bytesTransferred: 0,
        direction: "receive",
        status: "in-progress",
      });
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

    session.emitProgress({
      fileId: message.fileId,
      fileName: message.name,
      fileSize: message.size,
      bytesTransferred: 0,
      direction: "receive",
      status: "pending",
    });
  }

  onStart(fileId: string) {
    const { session } = this;
    if (session.cancelledFileIds.has(fileId)) return;
    if (session.dismissedReceivedIds.has(fileId)) return;

    const meta = session.pendingMetas.get(fileId);
    if (!meta) return;

    session.pendingMetas.delete(fileId);
    void this.beginReceive(meta);
    session.emitProgress({
      fileId: meta.fileId,
      fileName: meta.name,
      fileSize: meta.size,
      bytesTransferred: 0,
      direction: "receive",
      status: "in-progress",
    });
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

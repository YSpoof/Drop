import type { EnvironmentPort } from "#lib/ports/environment.js";
import type { DownloadService } from "#lib/services/downloadService.js";
import { DownloadError } from "#lib/utils/files/transferTypes.js";
import { ZipDownloadSession } from "#lib/utils/files/zipDownload.js";

import type { FileMeta } from "./protocol";
import type { TransferSender } from "./sender";
import type { ReceiveState, TransferSession } from "./session";

export class TransferReceiver {
  constructor(
    private readonly session: TransferSession,
    private readonly sender: TransferSender,
    private readonly downloads: DownloadService,
    private readonly environment: EnvironmentPort,
  ) {}

  private usesZip(meta: FileMeta): boolean {
    if (this.environment.hasNativeFs) return false;

    const { session } = this;
    const receiver = session.receiver;
    if (receiver.activePullBatch) return true;
    if (!session.manualDownload && meta.name.includes("/")) return true;
    return false;
  }

  private zipFilenameFor(meta: FileMeta): string | undefined {
    const slash = meta.name.indexOf("/");
    if (slash > 0) return `${meta.name.slice(0, slash)}.zip`;
    return undefined;
  }

  private downloadFilename(meta: FileMeta): string {
    if (this.environment.hasNativeFs) return meta.name;
    return meta.name.split("/").pop() || meta.name;
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
    const remaining = state.meta.size - state.receivedBytes;
    if (remaining <= 0) return;
    const chunk = remaining < data.byteLength ? data.slice(0, remaining) : data;
    await this.writeReceivedChunk(state, chunk);
    const chunkBytes = chunk.byteLength;
    state.receivedBytes += chunkBytes;
    this.session.callbacks.onChunkBytes?.("receive", chunkBytes);
    if (state.receivedBytes >= state.meta.size) {
      this.session.sender.expectingBinary = false;
    }
  }

  private abortStream(state: ReceiveState) {
    void state.streamWriter?.abort().catch(() => undefined);
  }

  private armReceive(meta: FileMeta, chunkSize: number) {
    void this.beginReceive(meta, chunkSize);
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
    if (state.receivedBytes >= state.meta.size) {
      void this.finishReceive(fileId);
    }
  }

  beginReceive(meta: FileMeta, chunkSize: number) {
    const { session } = this;
    const sender = session.sender;
    const receiver = session.receiver;
    const useZip = this.usesZip(meta);

    const state: ReceiveState = {
      meta,
      receivedBytes: 0,
      pendingChunks: [],
      sessionOpen: false,
      useZip,
      senderDone: false,
    };
    receiver.receiving.set(meta.fileId, state);
    sender.expectingBinary = true;

    if (receiver.preReceiveChunks.length) {
      state.pendingChunks.push(...receiver.preReceiveChunks);
      receiver.preReceiveChunks = [];
    }

    session.chunkWriteQueue = session.chunkWriteQueue
      .then(async () => {
        const existing =
          !useZip && meta.hash ? await this.downloads.getResumeOffset(meta.hash, meta.size) : 0;
        const aligned = Math.floor(existing / chunkSize) * chunkSize;
        state.receivedBytes = aligned;

        if (useZip) {
          state.streamWriter = await this.getOrCreateZipSession(
            receiver.activePullBatchFilename ?? this.zipFilenameFor(meta),
          ).openEntry(meta.name, meta.size);
        } else {
          state.streamWriter = await this.downloads.createWriter(this.downloadFilename(meta), {
            size: meta.size,
            mime: meta.mime,
            hash: meta.hash,
            startOffset: aligned,
            onAbort: () => this.abortBrowserDownload(meta.fileId),
          });
        }
        state.sessionOpen = true;

        await session.io.sendControl({
          type: "resume",
          fileId: meta.fileId,
          hash: meta.hash ?? "",
          bytesOffset: aligned,
        });

        const buffered = state.pendingChunks;
        state.pendingChunks = [];
        for (const chunk of buffered) {
          await this.applyChunkBytes(state, chunk);
        }

        if (state.receivedBytes > 0) {
          session.emitReceiveProgress(meta, "in-progress", state.receivedBytes);
        }

        if (state.senderDone && state.receivedBytes >= state.meta.size) {
          await this.finishReceive(meta.fileId);
        }
      })
      .catch((error) => {
        const current = receiver.receiving.get(meta.fileId);
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
    if (session.aborted) return;
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
    const receiver = session.receiver;
    const state = receiver.receiving.get(fileId);
    if (!state || state.finishing) return;

    if (state.receivedBytes < state.meta.size) {
      this.failReceive(fileId, state, "Incomplete file received");
      return;
    }

    state.finishing = true;

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
      receiver.activePullBatch &&
      receiver.activePullBatch.length > 1
    ) {
      receiver.pullBatchReceivedCount += 1;
      if (receiver.pullBatchReceivedCount >= receiver.activePullBatch.length) {
        try {
          await receiver.zipSession?.finalize();
        } catch (error) {
          this.failReceive(
            fileId,
            state,
            error instanceof Error ? error.message : "Failed to finalize zip download",
          );
          return;
        }
        receiver.zipSession = null;
        receiver.clearPullBatch();
        session.completeReceiveBatch();
      }
    } else if (!state.useZip && session.manualDownload) {
      session.completeReceiveBatch();
    }

    session.emitReceiveHistory(state.meta, "completed");
    receiver.receiving.delete(fileId);
    session.emitReceiveProgress(state.meta, "completed", state.meta.size);

    void session.io.sendControl({ type: "ack", fileId });
    void this.sender.trySendNext();
  }

  private getOrCreateZipSession(filename?: string) {
    const receiver = this.session.receiver;
    if (!receiver.zipSession || receiver.zipSession.isFinalized()) {
      receiver.zipSession = new ZipDownloadSession(this.downloads, filename, {
        onAbort: () => this.onZipDownloadAborted(),
      });
    }
    return receiver.zipSession;
  }

  private onZipDownloadAborted() {
    const { session } = this;
    const sender = session.sender;
    const receiver = session.receiver;
    for (const fileId of [...receiver.receiving.keys()]) {
      this.abortBrowserDownload(fileId);
    }
    receiver.zipSession = null;
    receiver.clearPullBatch();
  }

  abortBrowserDownload(fileId: string) {
    const { session } = this;
    if (session.aborted || session.cancelledFileIds.has(fileId)) return;
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

  discardReceive(fileId: string) {
    const { session } = this;
    const state = session.receiver.receiving.get(fileId);
    const hash =
      state?.meta.hash ??
      session.receiver.pendingMetas.get(fileId)?.hash ??
      session.receiver.awaitingStart.get(fileId)?.hash;
    if (state) session.receiver.receiving.delete(fileId);
    void (state?.streamWriter?.abort("discard") ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => (hash ? this.downloads.dropIncomplete(hash) : undefined));
  }

  dismissReceived(fileId: string) {
    const { session } = this;
    const sender = session.sender;
    if (session.dismissedReceivedIds.has(fileId)) return;
    session.dismissedReceivedIds.add(fileId);

    session.receiver.pendingMetas.delete(fileId);
    session.receiver.awaitingStart.delete(fileId);

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
    const receiver = this.session.receiver;
    if (receiver.zipSession && !receiver.zipSession.isFinalized()) {
      await receiver.zipSession.finalize();
      receiver.zipSession = null;
    }
  }

  async cleanupReceives() {
    const { session } = this;
    const sender = session.sender;
    const receiver = session.receiver;
    const receiving = [...receiver.receiving.values()];
    await session.chunkWriteQueue.catch(() => undefined);

    for (const state of receiving) {
      await state.streamWriter?.abort().catch(() => undefined);
    }

    if (receiver.zipSession && !receiver.zipSession.isFinalized()) {
      await receiver.zipSession.finalize().catch(() => undefined);
    }
    receiver.zipSession = null;
  }

  requestPull(fileId: string) {
    const { session } = this;
    const sender = session.sender;
    const receiver = session.receiver;
    const meta = receiver.pendingMetas.get(fileId);
    if (!meta) return;

    receiver.pendingMetas.delete(fileId);
    receiver.awaitingStart.set(fileId, meta);
    sender.expectingBinary = true;
    receiver.clearPullBatch();
    receiver.activeReceiveBatch = { id: crypto.randomUUID(), fileCount: 1 };

    void session.io.sendControl({ type: "pull", fileId });
  }

  requestPullBatch(fileIds: string[], zipFilename?: string) {
    const { session } = this;
    const sender = session.sender;
    const receiver = session.receiver;
    const validIds = fileIds.filter((id) => receiver.pendingMetas.has(id));
    if (!validIds.length) return;

    receiver.activePullBatch = validIds;
    receiver.activePullBatchFilename = zipFilename;
    receiver.pullBatchReceivedCount = 0;
    receiver.activeReceiveBatch = { id: crypto.randomUUID(), fileCount: validIds.length };

    for (const fileId of validIds) {
      const meta = receiver.pendingMetas.get(fileId)!;
      receiver.pendingMetas.delete(fileId);
      receiver.awaitingStart.set(fileId, meta);
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

  onStart(fileId: string, chunkSize: number) {
    const { session } = this;
    if (session.cancelledFileIds.has(fileId)) return;
    if (session.dismissedReceivedIds.has(fileId)) return;

    const meta =
      session.receiver.pendingMetas.get(fileId) ?? session.receiver.awaitingStart.get(fileId);
    if (!meta) return;

    session.receiver.pendingMetas.delete(fileId);
    session.receiver.awaitingStart.delete(fileId);
    this.armReceive(meta, chunkSize);
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

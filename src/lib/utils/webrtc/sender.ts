import type { QueuedFile } from "#lib/utils/files/queue.js";

import { fileIdentity } from "./protocol";
import type { TransferSession } from "./session";

export class TransferSender {
  constructor(private readonly session: TransferSession) {}

  notifyQueueChanged() {
    void this.trySendNext();
  }

  resolveQueuedFile(fileId: string): QueuedFile | undefined {
    const { session } = this;
    if (session.cancelledFileIds.has(fileId)) return undefined;
    return (
      session.sender.announcedFiles.get(fileId) ??
      session.callbacks.getSendQueue().find((item) => item.id === fileId)
    );
  }

  async processNextPull() {
    const { session } = this;
    const { sender } = session;
    if (session.aborted || sender.sending || !sender.pendingPulls.length) return;
    while (sender.pendingPulls.length && session.cancelledFileIds.has(sender.pendingPulls[0]!)) {
      sender.pendingPulls.shift();
    }
    if (!sender.pendingPulls.length) return;
    const fileId = sender.pendingPulls[0]!;
    await this.sendFileBinary(fileId);
  }

  private async beginSend(queued: QueuedFile) {
    const { session } = this;
    const sender = session.sender;
    sender.downloadAbortedSendIds.delete(queued.id);
    sender.sending = true;
    sender.currentSendFile = queued;

    await session.io.sendControl({
      type: "start",
      fileId: queued.id,
      chunkSize: session.chunkSize,
    });

    const offset = await sender.resumeSlot(queued.id).promise;
    if (session.shouldStopSend(queued.id) || sender.currentSendFile?.id !== queued.id) {
      sender.clearSending();
      void this.trySendNext();
      void this.processNextPull();
      return;
    }

    session.emitQueuedProgress(queued, "in-progress", offset);
    const completed = await this.sendFileChunks(queued, offset);
    if (!completed) {
      void this.trySendNext();
      void this.processNextPull();
    }
  }

  private async sendFileBinary(fileId: string) {
    const { session } = this;
    const sender = session.sender;
    if (session.aborted || sender.sending || !session.channelsOpen()) return;

    const queued = this.resolveQueuedFile(fileId);
    if (!queued) {
      sender.pendingPulls.shift();
      void this.processNextPull();
      return;
    }

    session.ensureSendBatch(sender.pendingPulls.length);
    await this.beginSend(queued);
  }

  announcePendingFiles() {
    const { session } = this;
    const sender = session.sender;

    const queue = session.callbacks
      .getSendQueue()
      .filter((item) => !session.cancelledFileIds.has(item.id));
    const toAnnounce = queue.filter(
      (queued) => !sender.announcedFiles.has(queued.id) && !sender.servedFileIds.has(queued.id),
    );
    if (toAnnounce.length) {
      session.ensureSendBatch(toAnnounce.length);
    }

    for (const queued of queue) {
      if (
        sender.announcedFiles.has(queued.id) ||
        session.cancelledFileIds.has(queued.id) ||
        sender.servedFileIds.has(queued.id)
      )
        continue;

      const meta = session.buildFileMeta(queued);

      void session.io.sendControl(meta);
      sender.announcedFiles.set(queued.id, queued);
      sender.announcedOrder.push(queued.id);
      session.emitQueuedProgress(queued, "pending");
    }
  }

  private async sendNextAutoBinary() {
    const { session } = this;
    const sender = session.sender;
    if (sender.sending || session.peerManualDownload) return;

    const fileId = sender.announcedOrder.find(
      (id) =>
        sender.announcedFiles.has(id) &&
        !session.cancelledFileIds.has(id) &&
        !sender.downloadAbortedSendIds.has(id) &&
        !sender.servedFileIds.has(id),
    );
    if (!fileId) return;

    const queued = sender.announcedFiles.get(fileId);
    if (!queued) return;

    await this.beginSend(queued);
  }

  private hasUnservedAnnounced(): boolean {
    const { session } = this;
    const sender = session.sender;
    for (const id of sender.announcedOrder) {
      if (session.cancelledFileIds.has(id)) continue;
      if (!sender.announcedFiles.has(id)) continue;
      if (!sender.servedFileIds.has(id)) return true;
    }
    return false;
  }

  notifyBatchDoneIfIdle() {
    const { session } = this;
    const sender = session.sender;
    if (sender.sending) return;
    if (sender.pendingPulls.length) return;

    this.announcePendingFiles();

    if (this.hasUnservedAnnounced()) {
      if (!session.peerManualDownload) {
        void this.sendNextAutoBinary();
      }
      return;
    }

    session.completeSendBatch();
    void session.io.sendControl({ type: "batch-done" });
  }

  async trySendNext() {
    const { session } = this;
    const sender = session.sender;
    if (session.aborted || !session.channelsOpen()) return;

    this.announcePendingFiles();

    if (session.peerManualDownload) {
      this.notifyBatchDoneIfIdle();
      return;
    }

    if (sender.sending) return;

    await this.sendNextAutoBinary();
  }

  onAck(fileId: string) {
    const { session } = this;
    const sender = session.sender;
    if (session.cancelledFileIds.has(fileId)) {
      sender.clearSending();
      void this.trySendNext();
      return;
    }
    sender.sending = false;
    sender.servedFileIds.add(fileId);
    if (sender.currentSendFile?.id === fileId) {
      sender.announcedFiles.delete(fileId);
      sender.announcedOrder = sender.announcedOrder.filter((id) => id !== fileId);
      sender.currentSendFile = null;
    }
    session.releaseFileTracking(fileId);
    if (sender.pendingPulls.length) {
      sender.pendingPulls.shift();
    }
    void this.trySendNext().then(() => {
      void this.processNextPull();
      this.notifyBatchDoneIfIdle();
    });
  }

  stopReceiveDownload(fileId: string) {
    const { session } = this;
    const sender = session.sender;
    const queued =
      sender.currentSendFile?.id === fileId
        ? sender.currentSendFile
        : this.resolveQueuedFile(fileId);

    sender.downloadAbortedSendIds.add(fileId);

    if (sender.currentSendFile?.id === fileId) {
      sender.clearSending();
    }
    sender.pendingPulls = sender.pendingPulls.filter((id) => id !== fileId);

    if (queued) {
      session.emitQueuedProgress(queued, "pending");
    }

    this.notifyBatchDoneIfIdle();
    void this.processNextPull();
  }

  private enqueuePullIds(fileIds: string[]) {
    for (const fileId of fileIds) {
      this.session.sender.downloadAbortedSendIds.delete(fileId);
    }
    this.session.sender.pendingPulls.push(...fileIds);
    void this.processNextPull();
  }

  enqueuePull(fileId: string) {
    this.enqueuePullIds([fileId]);
  }

  enqueuePullBatch(fileIds: string[]) {
    this.enqueuePullIds(fileIds);
  }

  /** Shared chunk loop used by pull-send and auto-send. */
  async sendFileChunks(queued: QueuedFile, startOffset = 0): Promise<boolean> {
    const { session } = this;
    const sender = session.sender;
    const totalChunks = Math.ceil(queued.file.size / session.chunkSize);
    const startIndex = Math.floor(startOffset / session.chunkSize);
    let bytesSent = startIndex * session.chunkSize;

    for (let index = startIndex; index < totalChunks; index += 1) {
      if (session.shouldStopSend(queued.id)) {
        sender.clearSending();
        return false;
      }
      const offset = index * session.chunkSize;

      let buffer: ArrayBuffer | undefined;
      if (session.callbacks.readFileChunk) {
        buffer = await session.callbacks.readFileChunk(queued, offset, session.chunkSize);
      }
      if (!buffer) {
        const slice = queued.file.slice(offset, offset + session.chunkSize);
        buffer = await slice.arrayBuffer();
      }
      if (session.shouldStopSend(queued.id)) {
        sender.clearSending();
        return false;
      }
      await session.io.sendBuffer(buffer);
      if (session.shouldStopSend(queued.id)) {
        sender.clearSending();
        return false;
      }
      session.callbacks.onChunkBytes?.("send", buffer.byteLength);
      bytesSent += buffer.byteLength;
      session.emitQueuedProgress(queued, "in-progress", bytesSent);
    }

    if (session.shouldStopSend(queued.id)) {
      sender.clearSending();
      return false;
    }

    await session.io.sendControl({ type: "done", fileId: queued.id });

    sender.servedFileIds.add(queued.id);
    session.emitHistory(
      session.withBatchContext({
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

  onResume(fileId: string, hash: string, bytesOffset: number) {
    const queued = this.resolveQueuedFile(fileId);
    const match =
      queued && hash === fileIdentity(queued.path, queued.file.size, queued.file.lastModified);
    this.session.sender.resumeSlot(fileId).resolve(match ? bytesOffset : 0);
  }
}

import type { QueuedFile } from "$lib/utils/files/queue";

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
      session.announcedFiles.get(fileId) ??
      session.callbacks.getSendQueue().find((item) => item.id === fileId)
    );
  }

  async processNextPull() {
    const { session } = this;
    if (session.aborted || session.sending || !session.pendingPulls.length) return;
    while (session.pendingPulls.length && session.cancelledFileIds.has(session.pendingPulls[0]!)) {
      session.pendingPulls.shift();
    }
    if (!session.pendingPulls.length) return;
    const fileId = session.pendingPulls[0]!;
    await this.sendFileBinary(fileId);
  }

  private async sendFileBinary(fileId: string) {
    const { session } = this;
    if (session.aborted || session.sending || session.channel.readyState !== "open") return;

    const queued = this.resolveQueuedFile(fileId);
    if (!queued) {
      session.pendingPulls.shift();
      void this.processNextPull();
      return;
    }

    session.ensureSendBatch(session.pendingPulls.length);
    session.downloadAbortedSendIds.delete(fileId);
    session.sending = true;
    session.currentSendFile = queued;

    session.emitProgress({
      fileId: queued.id,
      fileName: queued.path,
      fileSize: queued.file.size,
      bytesTransferred: 0,
      direction: "send",
      status: "in-progress",
    });

    await session.sendFileChunks(queued);
  }

  announcePendingFiles() {
    const { session } = this;
    if (session.sending) return;

    const queue = session.callbacks
      .getSendQueue()
      .filter((item) => !session.cancelledFileIds.has(item.id));
    const toAnnounce = queue.filter(
      (queued) => !session.announcedFiles.has(queued.id) && !session.servedFileIds.has(queued.id),
    );
    if (toAnnounce.length) {
      session.ensureSendBatch(toAnnounce.length);
    }

    for (const queued of queue) {
      if (
        session.announcedFiles.has(queued.id) ||
        session.cancelledFileIds.has(queued.id) ||
        session.servedFileIds.has(queued.id)
      )
        continue;

      const meta = session.buildFileMeta(queued);

      void session.io.sendControl(meta);
      session.announcedFiles.set(queued.id, queued);
      session.announcedOrder.push(queued.id);
      session.emitProgress({
        fileId: queued.id,
        fileName: queued.path,
        fileSize: queued.file.size,
        bytesTransferred: 0,
        direction: "send",
        status: "pending",
      });
    }
  }

  private async sendNextAutoBinary() {
    const { session } = this;
    if (session.sending || session.peerManualDownload) return;

    const fileId = session.announcedOrder.find(
      (id) =>
        session.announcedFiles.has(id) &&
        !session.cancelledFileIds.has(id) &&
        !session.downloadAbortedSendIds.has(id) &&
        !session.servedFileIds.has(id),
    );
    if (!fileId) return;

    const queued = session.announcedFiles.get(fileId);
    if (!queued) return;

    session.downloadAbortedSendIds.delete(fileId);
    session.sending = true;
    session.currentSendFile = queued;

    await session.io.sendControl({ type: "start", fileId });

    session.emitProgress({
      fileId: queued.id,
      fileName: queued.path,
      fileSize: queued.file.size,
      bytesTransferred: 0,
      direction: "send",
      status: "in-progress",
    });

    const completed = await session.sendFileChunks(queued);
    if (!completed) {
      void this.trySendNext();
    }
  }

  private hasUnservedAnnounced(): boolean {
    const { session } = this;
    for (const id of session.announcedOrder) {
      if (session.cancelledFileIds.has(id)) continue;
      if (!session.announcedFiles.has(id)) continue;
      if (!session.servedFileIds.has(id)) return true;
    }
    return false;
  }

  notifyBatchDoneIfIdle() {
    const { session } = this;
    if (session.sending) return;
    if (session.pendingPulls.length) return;

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
    if (session.aborted || session.channel.readyState !== "open") return;

    this.announcePendingFiles();

    if (session.peerManualDownload) {
      this.notifyBatchDoneIfIdle();
      return;
    }

    if (session.sending) return;

    await this.sendNextAutoBinary();
  }

  onAck(fileId: string) {
    const { session } = this;
    if (session.cancelledFileIds.has(fileId)) {
      session.sending = false;
      session.currentSendFile = null;
      void this.trySendNext();
      return;
    }
    session.sending = false;
    if (session.currentSendFile) {
      session.servedFileIds.add(session.currentSendFile.id);
      session.currentSendFile = null;
    }
    if (session.pendingPulls.length) {
      session.pendingPulls.shift();
    }
    void this.trySendNext().then(() => {
      void this.processNextPull();
      this.notifyBatchDoneIfIdle();
    });
  }

  stopReceiveDownload(fileId: string) {
    const { session } = this;
    const queued =
      session.currentSendFile?.id === fileId
        ? session.currentSendFile
        : (session.announcedFiles.get(fileId) ??
          session.callbacks.getSendQueue().find((item) => item.id === fileId));

    session.downloadAbortedSendIds.add(fileId);

    if (session.currentSendFile?.id === fileId) {
      session.sending = false;
      session.currentSendFile = null;
    }
    session.pendingPulls = session.pendingPulls.filter((id) => id !== fileId);

    if (queued) {
      session.emitProgress({
        fileId: queued.id,
        fileName: queued.path,
        fileSize: queued.file.size,
        bytesTransferred: 0,
        direction: "send",
        status: "pending",
      });
    }

    this.notifyBatchDoneIfIdle();
    void this.processNextPull();
  }

  enqueuePull(fileId: string) {
    this.session.downloadAbortedSendIds.delete(fileId);
    this.session.pendingPulls.push(fileId);
    void this.processNextPull();
  }

  enqueuePullBatch(fileIds: string[]) {
    for (const fileId of fileIds) {
      this.session.downloadAbortedSendIds.delete(fileId);
    }
    this.session.pendingPulls.push(...fileIds);
    void this.processNextPull();
  }
}

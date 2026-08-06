import { logger } from "$lib/utils/logger";

import { DataChannelIo } from "./channelIo";
import { resolveBufferHighWater, resolveBufferLowWater } from "./chunkSize";
import { describeControlMessage, parseControlMessage, type TransferCallbacks } from "./protocol";
import { TransferReceiver } from "./receiver";
import { TransferSender } from "./sender";
import { TransferSession } from "./session";

export { type TransferCallbacks, type TransferProgress } from "./protocol";

export class TransferManager {
  private readonly session: TransferSession;
  private readonly sender: TransferSender;
  private readonly receiver: TransferReceiver;

  constructor(
    control: RTCDataChannel,
    files: RTCDataChannel,
    chunkSize: number,
    callbacks: TransferCallbacks,
  ) {
    files.binaryType = "arraybuffer";
    const abortState = { shouldAbort: () => false };
    const io = new DataChannelIo(
      control,
      files,
      () => abortState.shouldAbort(),
      resolveBufferHighWater(chunkSize),
      resolveBufferLowWater(chunkSize),
    );
    this.session = new TransferSession(control, files, callbacks, io, chunkSize);
    abortState.shouldAbort = () => {
      const { session } = this;
      if (session.aborted) return true;
      const fileId = session.sender.currentSendFile?.id;
      return fileId != null && session.shouldStopSend(fileId);
    };
    this.sender = new TransferSender(this.session);
    this.receiver = new TransferReceiver(this.session, this.sender);
    control.onmessage = (event) => this.handleControlEvent(event);
    files.onmessage = (event) => this.handleFilesEvent(event);
  }

  start() {
    if (this.session.callbacks.isOfferer) {
      void this.sender.trySendNext();
    }
  }

  notifyQueueChanged() {
    this.sender.notifyQueueChanged();
  }

  sendBye() {
    void this.session.io.sendControl({ type: "bye" });
  }

  setManualDownload(manual: boolean) {
    if (this.session.manualDownload === manual) return;
    this.session.manualDownload = manual;
    void this.session.io.sendControl({ type: "download-mode", manual });
  }

  requestPull(fileId: string) {
    this.receiver.requestPull(fileId);
  }

  requestPullBatch(fileIds: string[], zipFilename?: string) {
    this.receiver.requestPullBatch(fileIds, zipFilename);
  }

  dismissReceivedFile(fileId: string) {
    this.receiver.dismissReceived(fileId);
  }

  cancelFile(fileId: string, notifyPeer = true) {
    const { session, sender } = this;
    if (session.aborted || session.cancelledFileIds.has(fileId)) return;
    session.cancelledFileIds.add(fileId);

    session.sender.announcedFiles.delete(fileId);
    session.sender.announcedOrder = session.sender.announcedOrder.filter((id) => id !== fileId);
    session.receiver.pendingMetas.delete(fileId);
    session.sender.pendingPulls = session.sender.pendingPulls.filter((id) => id !== fileId);

    if (session.sender.currentSendFile?.id === fileId) {
      session.sender.clearSending();
    }

    const recvState = session.receiver.receiving.get(fileId);
    if (recvState) {
      void recvState.streamWriter?.abort().catch(() => undefined);
      session.receiver.receiving.delete(fileId);
    }

    if (notifyPeer) {
      void session.io.sendControl({ type: "cancel", fileId });
    }

    session.callbacks.onFileCancelled?.(fileId);
    session.releaseFileTracking(fileId);
    session.pruneIdleTracking();
    void sender.trySendNext();
  }

  abort() {
    void this.receiver.cleanupReceives();
    this.session.resetForAbort();
    this.session.callbacks.onAbort?.();
  }

  private handleControlEvent(event: MessageEvent) {
    if (typeof event.data !== "string") return;
    this.handleControlMessage(event.data);
  }

  private handleFilesEvent(event: MessageEvent) {
    if (!(event.data instanceof ArrayBuffer)) return;

    const { session } = this;
    if (session.receiver.receiving.size > 0 || session.sender.expectingBinary) {
      this.receiver.handleBinaryChunk(event.data);
    } else {
      session.receiver.preReceiveChunks.push(event.data);
    }
  }

  private handleControlMessage(raw: string) {
    const message = parseControlMessage(raw);
    if (!message) return;
    logger.log(`(Ctrl) ← ${describeControlMessage(message)}`);

    switch (message.type) {
      case "meta":
        this.receiver.onMeta(message);
        break;
      case "start":
        this.receiver.onStart(message.fileId);
        break;
      case "done":
        this.session.chunkWriteQueue = this.session.chunkWriteQueue.then(() =>
          this.receiver.onSendDone(message.fileId),
        );
        break;
      case "ack":
        this.sender.onAck(message.fileId);
        break;
      case "batch-done":
        this.receiver.onBatchDone();
        break;
      case "bye":
        this.session.callbacks.onBye?.();
        break;
      case "download-mode":
        this.session.peerManualDownload = message.manual;
        void this.sender.trySendNext();
        break;
      case "pull":
        this.sender.enqueuePull(message.fileId);
        break;
      case "pull-batch":
        this.sender.enqueuePullBatch(message.fileIds);
        break;
      case "cancel":
        this.cancelFile(message.fileId, false);
        break;
      case "download-aborted":
        this.sender.stopReceiveDownload(message.fileId);
        break;
    }
  }
}

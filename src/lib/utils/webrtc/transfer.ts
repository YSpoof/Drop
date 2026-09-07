import type { Channel } from "fastrtc";

import type { EnvironmentPort } from "#lib/ports/environment.js";
import type { DownloadService } from "#lib/services/downloadService.js";
import { logger } from "#lib/utils/logger.js";

import { describeControlMessage, parseControlMessage, type TransferCallbacks } from "./protocol";
import { TransferReceiver } from "./receiver";
import { TransferSender } from "./sender";
import { TransferSession } from "./session";

export class TransferManager {
  private readonly session: TransferSession;
  private readonly sender: TransferSender;
  private readonly receiver: TransferReceiver;
  private readonly stopListeners: () => void;

  constructor(
    control: Channel,
    files: Channel,
    callbacks: TransferCallbacks,
    downloads: DownloadService,
    environment: EnvironmentPort,
  ) {
    this.session = new TransferSession(control, files, callbacks);
    this.sender = new TransferSender(this.session);
    this.receiver = new TransferReceiver(this.session, this.sender, downloads, environment);

    const listeners = new AbortController();
    control.addEventListener(
      "message",
      ({ data }) => {
        if (typeof data !== "string") return;
        this.handleControlMessage(data);
      },
      { signal: listeners.signal },
    );
    files.addEventListener(
      "message",
      ({ data }) => {
        if (!(data instanceof ArrayBuffer)) return;
        const { session } = this;
        if (session.receiver.receiving.size > 0 || session.sender.expectingBinary) {
          this.receiver.handleBinaryChunk(data);
        } else {
          session.receiver.preReceiveChunks.push(data);
        }
      },
      { signal: listeners.signal },
    );
    this.stopListeners = () => listeners.abort();
  }

  start() {
    void this.sender.trySendNext();
  }

  notifyQueueChanged() {
    this.sender.notifyQueueChanged();
  }

  sendBye() {
    this.session.sendControl({ type: "bye" });
  }

  setManualDownload(manual: boolean) {
    if (this.session.manualDownload === manual) return;
    this.session.manualDownload = manual;
    this.session.sendControl({ type: "download-mode", manual });
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
    this.receiver.discardReceive(fileId);

    session.sender.announcedFiles.delete(fileId);
    session.sender.announcedOrder = session.sender.announcedOrder.filter((id) => id !== fileId);
    session.receiver.pendingMetas.delete(fileId);
    session.receiver.awaitingStart.delete(fileId);
    session.sender.pendingPulls = session.sender.pendingPulls.filter((id) => id !== fileId);

    if (session.sender.currentSendFile?.id === fileId) {
      session.sender.clearSending();
    }

    session.sender.releaseFileTracking(fileId);

    if (notifyPeer) {
      session.sendControl({ type: "cancel", fileId });
    }

    session.callbacks.onFileCancelled?.(fileId);
    void sender.trySendNext();
  }

  abort() {
    this.session.aborted = true;
    this.session.sender.sendAbort?.abort();
    void this.receiver.cleanupReceives();
    this.stopListeners();
    this.session.resetForAbort();
    this.session.callbacks.onAbort?.();
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
        this.receiver.onStart(message.fileId, message.chunkSize);
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
      case "resume":
        this.sender.onResume(message.fileId, message.hash, message.bytesOffset);
        break;
    }
  }
}

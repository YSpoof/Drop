import { DataChannelIo } from "./channelIo";
import { resolveBufferHighWater, resolveBufferLowWater } from "./chunkSize";
import { parseControlMessage, type TransferCallbacks } from "./protocol";
import { TransferReceiver } from "./receiver";
import { TransferSender } from "./sender";
import { TransferSession } from "./session";

export { type TransferCallbacks, type TransferProgress } from "./protocol";

export class TransferManager {
  private readonly session: TransferSession;
  private readonly sender: TransferSender;
  private readonly receiver: TransferReceiver;

  constructor(channel: RTCDataChannel, chunkSize: number, callbacks: TransferCallbacks) {
    channel.binaryType = "arraybuffer";
    const abortState = { shouldAbort: () => false };
    const io = new DataChannelIo(
      channel,
      () => abortState.shouldAbort(),
      resolveBufferHighWater(chunkSize),
      resolveBufferLowWater(chunkSize),
    );
    this.session = new TransferSession(channel, callbacks, io, chunkSize);
    abortState.shouldAbort = () => {
      const session = this.session;
      if (session.aborted) return true;
      const fileId = session.currentSendFile?.id;
      return fileId != null && session.shouldStopSend(fileId);
    };
    this.sender = new TransferSender(this.session);
    this.receiver = new TransferReceiver(this.session, this.sender);
    channel.onmessage = (event) => this.handleMessage(event);
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
    const { session } = this;
    if (session.aborted || session.cancelledFileIds.has(fileId)) return;
    session.cancelledFileIds.add(fileId);

    session.announcedFiles.delete(fileId);
    session.announcedOrder = session.announcedOrder.filter((id) => id !== fileId);
    session.pendingMetas.delete(fileId);
    session.pendingPulls = session.pendingPulls.filter((id) => id !== fileId);

    if (session.currentSendFile?.id === fileId) {
      session.sending = false;
      session.currentSendFile = null;
    }

    const recvState = session.receiving.get(fileId);
    if (recvState) {
      void recvState.streamWriter?.abort().catch(() => undefined);
      session.receiving.delete(fileId);
    }

    if (notifyPeer) {
      void session.io.sendControl({ type: "cancel", fileId });
    }

    session.callbacks.onFileCancelled?.(fileId);
    void this.sender.trySendNext();
  }

  abort() {
    const { session } = this;
    session.aborted = true;
    void this.receiver.cleanupReceives();
    session.receiving.clear();
    session.pendingMetas.clear();
    session.announcedFiles.clear();
    session.announcedOrder = [];
    session.pendingPulls = [];
    session.activePullBatch = null;
    session.activePullBatchFilename = undefined;
    session.pullBatchReceivedCount = 0;
    session.batchUsesZip = false;
    session.zipSession = null;
    session.activeSendBatch = null;
    session.activeReceiveBatch = null;
    session.sending = false;
    session.currentSendFile = null;
    session.expectingBinary = false;
    session.preReceiveChunks = [];
    session.downloadAbortedSendIds.clear();
    session.servedFileIds.clear();
    session.channel.onmessage = null;
    session.callbacks.onAbort?.();
  }

  private handleMessage(event: MessageEvent) {
    if (typeof event.data === "string") {
      this.handleControlMessage(event.data);
      return;
    }

    if (event.data instanceof ArrayBuffer) {
      const { session } = this;
      if (session.receiving.size > 0 || session.expectingBinary) {
        this.receiver.handleBinaryChunk(event.data);
      } else {
        session.preReceiveChunks.push(event.data);
      }
    }
  }

  private handleControlMessage(raw: string) {
    const message = parseControlMessage(raw);
    if (!message) return;

    switch (message.type) {
      case "meta":
        this.receiver.onMeta(message);
        break;
      case "start":
        this.receiver.onStart(message.fileId);
        break;
      case "done":
        this.session.chunkWriteQueue = this.session.chunkWriteQueue.then(() =>
          this.receiver.finishReceive(message.fileId),
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

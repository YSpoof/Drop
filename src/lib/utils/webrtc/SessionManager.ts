import { appState } from "$lib/stores/appState.svelte";
import { toastStore } from "$lib/stores/toast.svelte";
import type { QueuedFile } from "$lib/utils/files/queue";
import { abortAllDownloadStreams } from "$lib/utils/files/swDownload";
import type { BatchDoneInfo, HistoryEntry } from "$lib/utils/files/transferTypes";
import { logger } from "$lib/utils/logger";
import { SignalingClient } from "$lib/utils/signaling/client";
import type { PeerInfo } from "$lib/utils/signaling/types";
import { resolveChunkSize } from "$lib/utils/webrtc/chunkSize";
import { discoverLocalIps } from "$lib/utils/webrtc/discovery";
import { PeerConnection } from "$lib/utils/webrtc/peer";
import {
  TransferManager,
  type TransferProgress as TransferProgressState,
} from "$lib/utils/webrtc/transfer";

const ROOM_JOIN_TIMEOUT_MS = 15_000;
const ROOM_JOIN_CONNECTED_CLOSE_MS = 3_000;
const ROOM_JOIN_CLOSE_MS = 300;

type PendingBatchCompletion = {
  direction: HistoryEntry["direction"];
  succeeded: string[];
  fileCountInBatch: number;
};

export type SessionRoomAccessors = {
  getRoom: () => string | undefined;
  getRoomCode: () => string | undefined;
};

export class SessionManager {
  private readonly signaling = new SignalingClient();
  private peerConnection: PeerConnection | null = null;
  private transferManager: TransferManager | null = null;
  private activeTargetPeerId: string | null = null;
  private peerDisconnectHandled = false;
  private signalingDisconnectNotified = false;
  private queueNotifyDelayTimeout: ReturnType<typeof setTimeout> | null = null;
  private roomJoinTimeout: ReturnType<typeof setTimeout> | null = null;
  private roomJoinConnectedTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingBatchCompletions = new Map<string, PendingBatchCompletion>();
  private readonly getRoom: () => string | undefined;
  private readonly getRoomCode: () => string | undefined;

  constructor(accessors: SessionRoomAccessors) {
    this.getRoom = accessors.getRoom;
    this.getRoomCode = accessors.getRoomCode;
  }

  private findPeer(peerId: string) {
    return appState.peers.find((peer) => peer.peerId === peerId);
  }

  private clearPendingRequest() {
    appState.connectionModalOpen = false;
    setTimeout(() => {
      appState.pendingRequest = null;
    }, 300);
  }

  private handleHistoryToast(entry: HistoryEntry) {
    if (entry.status === "failed") {
      toastStore.showToast(`Falha ao transferir: ${entry.name}`, "error");
      return;
    }

    if (!entry.batchId) {
      const action = entry.direction === "sent" ? "enviado" : "recebido";
      toastStore.showToast(`Arquivo ${action}: ${entry.name}`, "success");
      return;
    }

    let batch = this.pendingBatchCompletions.get(entry.batchId);
    if (!batch) {
      batch = {
        direction: entry.direction,
        succeeded: [],
        fileCountInBatch: entry.fileCountInBatch ?? 1,
      };
      this.pendingBatchCompletions.set(entry.batchId, batch);
    }

    batch.succeeded.push(entry.name);
    if (entry.fileCountInBatch) {
      batch.fileCountInBatch = Math.max(batch.fileCountInBatch, entry.fileCountInBatch);
    }
  }

  private handleBatchDoneToast(info: BatchDoneInfo) {
    const batch = this.pendingBatchCompletions.get(info.batchId);
    if (!batch) return;

    const count = batch.succeeded.length;
    if (count === 0) {
      this.pendingBatchCompletions.delete(info.batchId);
      return;
    }

    if (info.fileCountInBatch < 2) {
      const action = info.direction === "sent" ? "enviado" : "recebido";
      toastStore.showToast(`Arquivo ${action}: ${batch.succeeded[0]}`, "success");
    } else {
      const action = info.direction === "sent" ? "enviados" : "recebidos";
      toastStore.showToast(`${count} arquivos ${action}`, "success");
    }

    this.pendingBatchCompletions.delete(info.batchId);
  }

  private clearPendingBatchCompletions() {
    this.pendingBatchCompletions.clear();
  }

  announce() {
    if (!this.signaling.isConnected()) return;
    const room = this.getRoom();
    logger.log(`(Room) announce room=${room ?? ""}`);
    this.signaling.announce({
      type: "announce",
      peerId: appState.identity.peerId,
      displayName: appState.displayName,
      deviceHint: appState.identity.deviceHint,
      room,
      localIps: appState.localIps,
    });
  }

  handleDisplayNameBlur() {
    appState.handleDisplayNameBlur();
    this.announce();
  }

  addFiles(files: FileList | File[] | { file: File; path: string }[]) {
    const newItems = appState.createAndQueue(files);
    if (newItems.length === 1) {
      const item = newItems[0]!;
      logger.log(`(Queue) +1 file: ${item.path} (${item.file.size}b)`);
    } else if (newItems.length > 1) {
      const root = newItems[0]!.path.split("/")[0];
      logger.log(`(Queue) +${newItems.length} files${newItems[0]?.zip ? " zip" : ""}: ${root}/...`);
    }

    if (appState.connected) {
      appState.promoteToHistory(newItems);
    }

    if (this.queueNotifyDelayTimeout) {
      clearTimeout(this.queueNotifyDelayTimeout);
    }

    this.queueNotifyDelayTimeout = setTimeout(() => {
      this.transferManager?.notifyQueueChanged();
      this.queueNotifyDelayTimeout = null;
    }, 500);
  }

  appendQueuedFiles(items: QueuedFile[]) {
    appState.appendQueue(items);
  }

  notifyQueueChanged() {
    this.transferManager?.notifyQueueChanged();
  }

  clearQueue() {
    for (const item of appState.queue) {
      const transfer = appState.transfers.find((entry) => entry.id === item.id);
      if (
        transfer &&
        transfer.direction === "sent" &&
        (transfer.status === "pending" || transfer.status === "in-progress")
      ) {
        this.transferManager?.cancelFile(item.id);
      }
    }
    appState.queue = [];
    if (this.queueNotifyDelayTimeout) {
      clearTimeout(this.queueNotifyDelayTimeout);
      this.queueNotifyDelayTimeout = null;
    }
  }

  handleDeleteTransfer(fileId: string | string[]) {
    const ids = Array.isArray(fileId) ? fileId : [fileId];
    for (const id of ids) {
      const item = appState.transfers.find((entry) => entry.id === id);
      if (!item || item.status === "completed" || item.status === "failed") continue;

      if (item.direction === "received") {
        if (this.transferManager) {
          this.transferManager.dismissReceivedFile(id);
        } else {
          appState.removeTransfer(id);
        }
        continue;
      }

      if (this.transferManager) {
        this.transferManager.cancelFile(id);
      } else {
        appState.removeFile(id);
      }
    }
  }

  handlePull(fileId: string) {
    const item = appState.transfers.find((entry) => entry.id === fileId);
    if (!item || item.status !== "pending") return;

    this.markTransfersInProgress([fileId]);
    this.transferManager?.requestPull(fileId);
  }

  handlePullBatch(fileIds: string[], zipFilename?: string) {
    const pendingIds = appState.pendingReceivedIds(fileIds);
    if (!pendingIds.length) return;

    this.markTransfersInProgress(pendingIds);
    this.transferManager?.requestPullBatch(pendingIds, zipFilename);
  }

  setManualDownload(manual: boolean) {
    this.transferManager?.setManualDownload(manual);
  }

  private suspendSignaling() {
    logger.log("(Room) suspend");
    this.signaling.suspend();
    appState.peers = [];
  }

  private async resumeSignaling() {
    logger.log("(Room) resume");
    this.signaling.resume();
  }

  private cleanupPeerConnection() {
    if (this.peerDisconnectHandled) return;
    this.peerDisconnectHandled = true;

    logger.log("(Room) peer disconnect");

    const roomJoinConnecting = appState.roomJoinOpen && appState.roomJoinPhase === "connecting";

    appState.resetTransferState();
    this.clearPendingBatchCompletions();
    this.transferManager?.abort();
    this.transferManager = null;

    appState.connectedPeerId = null;
    appState.connectedPeerInfo = null;
    appState.connectingPeerId = null;
    this.activeTargetPeerId = null;

    this.closePeerHandle(this.peerConnection);
    this.peerConnection = null;

    if (roomJoinConnecting) {
      this.unlockRoomJoin("Falha na conexão", "error");
      void this.resumeSignaling();
      return;
    }

    if (appState.roomJoinOpen) {
      this.clearRoomJoinState();
    }

    toastStore.showToast("Desconectado", "info");
    void this.resumeSignaling();
  }

  private closePeerHandle(pc: PeerConnection | null) {
    if (!pc) return;
    pc.onConnectionStateChange = null;
    pc.close();
  }

  private disposePeerConnection(options?: { markHandled?: boolean }) {
    if (options?.markHandled) this.peerDisconnectHandled = true;
    const pc = this.peerConnection;
    this.peerConnection = null;
    this.activeTargetPeerId = null;
    this.closePeerHandle(pc);
  }

  private sendConnectResponse(targetPeerId: string, accepted: boolean, reason?: string) {
    logger.log(
      `(Room) connect-response → ${targetPeerId} ${accepted ? "accepted" : "rejected"}${reason ? ` (${reason})` : ""}`,
    );
    this.signaling.send({ type: "connect-response", targetPeerId, accepted });
  }

  private markTransfersInProgress(ids: string[]) {
    for (const id of ids) {
      const item = appState.transfers.find((entry) => entry.id === id);
      if (!item) continue;
      appState.upsertTransfer({ ...item, status: "in-progress", bytesTransferred: 0 });
    }
  }

  private upsertFromProgress(progress: TransferProgressState) {
    const status =
      progress.status ??
      (progress.bytesTransferred >= progress.fileSize ? "completed" : "in-progress");
    appState.upsertTransfer({
      id: progress.fileId,
      name: progress.fileName,
      size: progress.fileSize,
      direction: progress.direction === "send" ? "sent" : "received",
      status,
      bytesTransferred: progress.bytesTransferred,
    });
  }

  private upsertFromHistory(entry: HistoryEntry) {
    appState.upsertTransfer({
      id: entry.id,
      name: entry.name,
      size: entry.size,
      direction: entry.direction,
      status: entry.status === "failed" ? "failed" : "completed",
      bytesTransferred: entry.size,
    });

    if (entry.status !== "failed") {
      appState.recordTransferFile(entry.direction);
    }

    this.handleHistoryToast(entry);
  }

  private handlePeerDisconnect() {
    this.cleanupPeerConnection();
  }

  disconnectPeer() {
    abortAllDownloadStreams();
    this.transferManager?.sendBye();
    this.cleanupPeerConnection();
  }

  private attachDataChannels(targetPeerId: string, offerer: boolean) {
    const peer = this.peerConnection;
    if (!peer) return;

    const { controlChannel: control, filesChannel: files } = peer;
    let started = false;

    const tryStart = () => {
      if (started) return;
      if (control.readyState !== "open" || files.readyState !== "open") return;
      started = true;

      const peerInfo = this.findPeer(targetPeerId);
      if (peerInfo) appState.connectedPeerInfo = peerInfo;

      appState.connectedPeerId = targetPeerId;
      appState.connectingPeerId = null;
      this.peerDisconnectHandled = false;
      logger.log("(Room) peer connect");
      this.clearRoomJoinTimeout();
      if (appState.roomJoinOpen) {
        this.finishRoomJoinSuccess();
      } else {
        toastStore.showToast("Conectado", "success");
      }
      this.suspendSignaling();

      let chunkSize: number;
      try {
        chunkSize = resolveChunkSize(peer.pc.sctp ?? null);
      } catch {
        toastStore.showToast("Conexão incompatível com este navegador", "error");
        this.cleanupPeerConnection();
        return;
      }

      this.transferManager = new TransferManager(control, files, chunkSize, {
        isOfferer: offerer,
        getSendQueue: () => appState.queue,
        onBye: () => {
          this.cleanupPeerConnection();
        },
        onChunkBytes: (direction, bytes) => {
          appState.recordTransferStats(direction === "send" ? "sent" : "received", bytes);
        },
        onProgress: (progress) => this.upsertFromProgress(progress),
        onHistory: (entry) => this.upsertFromHistory(entry),
        onBatchDone: (info) => this.handleBatchDoneToast(info),
        onFileCancelled: (fileId) => appState.removeFile(fileId),
        onFileDismissed: (fileId) => appState.removeTransfer(fileId),
        onDownloadError: (message) => {
          toastStore.showToast(message, "error");
        },
      });
      this.transferManager.setManualDownload(!appState.autoDownload);
      this.transferManager.start();
      if (appState.queue.length) {
        appState.promoteToHistory(appState.queue);
      }
      this.transferManager.notifyQueueChanged();
    };

    for (const channel of [control, files]) {
      channel.onopen = () => tryStart();
      channel.onclose = () => {
        this.handlePeerDisconnect();
      };
      if (channel.readyState === "open") tryStart();
    }
  }

  /**
   * Orchestrates the creation of a WebRTC PeerConnection, configuring ICE candidate exchange
   * via signaling, and preparing the underlying SCTP data channels for file transfer.
   */
  private setupPeerConnection(offerer: boolean, targetPeerId: string) {
    const previous = this.peerConnection;
    this.peerConnection = null;
    this.closePeerHandle(previous);

    this.peerDisconnectHandled = false;
    this.activeTargetPeerId = targetPeerId;
    this.peerConnection = new PeerConnection();

    this.peerConnection.onIceCandidate = (candidate) => {
      this.signaling.send({
        type: "ice-candidate",
        targetPeerId,
        candidate: candidate.toJSON(),
      });
    };

    this.peerConnection.onConnectionStateChange = (state) => {
      if (state === "failed" || state === "disconnected" || state === "closed") {
        this.handlePeerDisconnect();
      }
    };

    this.attachDataChannels(targetPeerId, offerer);
  }

  private isOfferer(peerId: string): boolean {
    return appState.identity.peerId < peerId;
  }

  private async sendOffer(targetPeerId: string) {
    if (!this.peerConnection) return;
    const offer = await this.peerConnection.createOffer();
    this.signaling.send({
      type: "sdp-offer",
      targetPeerId,
      sdp: offer,
    });
  }

  private beginAsAnswerer(requesterPeerId: string) {
    const peerInfo =
      this.findPeer(requesterPeerId) ??
      (appState.pendingRequest?.peerId === requesterPeerId
        ? appState.pendingRequest
        : appState.connectedPeerInfo);
    if (peerInfo) appState.connectedPeerInfo = peerInfo;
    this.setupPeerConnection(false, requesterPeerId);
  }

  private async beginAsOfferer(targetPeerId: string) {
    this.setupPeerConnection(true, targetPeerId);
    await this.sendOffer(targetPeerId);
  }

  private handleMutualConnect(requesterPeerId: string) {
    logger.log(`(Room) mutual connect with ${requesterPeerId}`);
    this.sendConnectResponse(requesterPeerId, true);

    if (this.isOfferer(requesterPeerId)) {
      void this.beginAsOfferer(requesterPeerId);
    } else {
      this.beginAsAnswerer(requesterPeerId);
    }
  }

  acceptPendingRequest() {
    if (!appState.pendingRequest) return;
    const requester = appState.pendingRequest;
    this.clearPendingRequest();
    appState.connectedPeerInfo = requester;

    this.sendConnectResponse(requester.peerId, true);
    this.beginAsAnswerer(requester.peerId);
  }

  denyPendingRequest() {
    if (!appState.pendingRequest) return;
    const requester = appState.pendingRequest;
    this.clearPendingRequest();
    this.sendConnectResponse(requester.peerId, false);
  }

  handleConnect(targetPeerId: string) {
    if (appState.connectingPeerId || appState.connectedPeerId) return;
    logger.log(`(Room) connect-request → ${targetPeerId}`);
    appState.connectingPeerId = targetPeerId;
    const peerInfo = this.findPeer(targetPeerId);
    if (peerInfo) appState.connectedPeerInfo = peerInfo;
    toastStore.showToast("Solicitando conexão…", "info");
    const roomCode = this.getRoomCode();
    if (roomCode) {
      this.signaling.send({ type: "connect-request", targetPeerId, roomCode });
    } else {
      this.signaling.send({ type: "connect-request", targetPeerId });
    }
  }

  generateRoomCode(): string {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return String(bytes[0]! % 1_000_000).padStart(6, "0");
  }

  private clearRoomJoinTimeout() {
    if (this.roomJoinTimeout) {
      clearTimeout(this.roomJoinTimeout);
      this.roomJoinTimeout = null;
    }
  }

  private clearRoomJoinConnectedTimeout() {
    if (this.roomJoinConnectedTimeout) {
      clearTimeout(this.roomJoinConnectedTimeout);
      this.roomJoinConnectedTimeout = null;
    }
  }

  private clearRoomJoinTimers() {
    this.clearRoomJoinTimeout();
    this.clearRoomJoinConnectedTimeout();
  }

  private clearRoomJoinState() {
    this.clearRoomJoinTimers();

    if (!appState.roomJoinOpen) {
      appState.roomJoinPhase = "waiting";
      appState.roomJoinMode = null;
      appState.roomJoinCode = null;
      appState.roomJoinTargetPeerId = null;
      return;
    }

    appState.roomJoinOpen = false;
    setTimeout(() => {
      appState.roomJoinPhase = "waiting";
      appState.roomJoinMode = null;
      appState.roomJoinCode = null;
      appState.roomJoinTargetPeerId = null;
    }, ROOM_JOIN_CLOSE_MS);
  }

  finishRoomJoinSuccess() {
    if (!appState.roomJoinOpen || this.roomJoinConnectedTimeout) return;

    this.clearRoomJoinTimeout();
    appState.roomJoinPhase = "connected";
    this.roomJoinConnectedTimeout = setTimeout(() => {
      this.roomJoinConnectedTimeout = null;
      this.clearRoomJoinState();
    }, ROOM_JOIN_CONNECTED_CLOSE_MS);
  }

  private failRoomJoinTimeout() {
    if (this.peerConnection) {
      this.disposePeerConnection({ markHandled: true });
    }

    appState.connectingPeerId = null;
    appState.connectedPeerInfo = null;
    this.clearRoomJoinTimers();
    this.suspendSignaling();
    appState.roomJoinPhase = "failed";
  }

  private startRoomJoinTimeout() {
    this.clearRoomJoinTimeout();
    this.roomJoinTimeout = setTimeout(() => {
      this.roomJoinTimeout = null;
      if (!appState.roomJoinOpen || appState.connectedPeerId) return;

      this.failRoomJoinTimeout();
    }, ROOM_JOIN_TIMEOUT_MS);
  }

  private tryRoomJoinConnect() {
    if (!appState.roomJoinOpen || appState.roomJoinPhase !== "waiting") return;
    if (appState.connectingPeerId || appState.connectedPeerId) return;

    const peer = appState.peers[0];
    if (!peer) return;

    appState.roomJoinPhase = "connecting";
    appState.roomJoinTargetPeerId = peer.peerId;
    appState.connectingPeerId = peer.peerId;
    appState.connectedPeerInfo = peer;

    if (appState.roomJoinMode === "auto" && appState.roomJoinCode) {
      logger.log(`(Room) connect-request → ${peer.peerId} roomCode=${appState.roomJoinCode}`);
      this.signaling.send({
        type: "connect-request",
        targetPeerId: peer.peerId,
        roomCode: appState.roomJoinCode,
      });
      return;
    }

    logger.log(`(Room) connect-request → ${peer.peerId}`);
    this.signaling.send({ type: "connect-request", targetPeerId: peer.peerId });
  }

  startRoomJoin(mode: "auto" | "ask", code?: string) {
    if (appState.connectedPeerId) return;
    appState.roomJoinOpen = true;
    appState.roomJoinMode = mode;
    appState.roomJoinCode = mode === "auto" ? (code ?? null) : null;
    appState.roomJoinPhase = "waiting";
    appState.roomJoinTargetPeerId = null;
    this.startRoomJoinTimeout();
    this.tryRoomJoinConnect();
  }

  unlockRoomJoin(message?: string, type: "error" | "warning" | "info" | "success" = "error") {
    if (appState.connectingPeerId && !appState.connectedPeerId) {
      appState.connectingPeerId = null;
      appState.connectedPeerInfo = null;
    }
    this.clearRoomJoinState();
    if (message) toastStore.showToast(message, type);
  }

  cancelRoomJoin() {
    if (!appState.roomJoinOpen) return;

    const wasConnecting = appState.roomJoinPhase === "connecting";
    this.clearRoomJoinTimers();

    if (wasConnecting && !appState.connectedPeerId) {
      appState.connectingPeerId = null;
      appState.connectedPeerInfo = null;

      if (this.peerConnection) {
        this.disposePeerConnection({ markHandled: true });
        void this.resumeSignaling();
      }
    }

    this.clearRoomJoinState();
  }

  async joinSignaling() {
    logger.log("(Room) joinSignaling");
    appState.localIps = appState.localIps.length > 0 ? appState.localIps : await discoverLocalIps();
    this.announce();
  }

  wakeSignaling(reason: "online" | "visibility") {
    if (appState.roomJoinPhase === "failed") return;
    this.signaling.wakeReconnect(reason);
  }

  connect() {
    this.signaling.connect({
      onOpen: () => {
        this.signalingDisconnectNotified = false;
        void this.joinSignaling();
      },
      onPeerList: (message: { peers: PeerInfo[] }) => {
        appState.peers = message.peers;

        if (
          appState.pendingRequest &&
          !message.peers.some((peer) => peer.peerId === appState.pendingRequest!.peerId)
        ) {
          const requesterName = appState.pendingRequest.displayName;
          this.clearPendingRequest();
          toastStore.showToast(`${requesterName} desconectou`, "warning");
        }

        if (appState.roomJoinOpen && appState.connectedPeerId) {
          this.finishRoomJoinSuccess();
        }

        if (
          appState.roomJoinOpen &&
          appState.roomJoinPhase !== "failed" &&
          appState.roomJoinPhase === "waiting"
        ) {
          this.tryRoomJoinConnect();
        }
      },
      onConnectRequest: (message: { requester: PeerInfo; roomCode?: string }) => {
        const requesterId = message.requester.peerId;
        const hostRoomCode = this.getRoomCode();
        logger.log(
          `(Room) connect-request ← ${requesterId}${message.roomCode ? ` roomCode=${message.roomCode}` : ""}`,
        );

        if (message.roomCode) {
          if (hostRoomCode && message.roomCode === hostRoomCode) {
            if (appState.connectedPeerId || appState.connectingPeerId || appState.pendingRequest) {
              this.sendConnectResponse(requesterId, false, "busy");
              return;
            }

            const peerInfo = this.findPeer(requesterId) ?? message.requester;
            appState.connectedPeerInfo = peerInfo;

            this.sendConnectResponse(requesterId, true);
            this.beginAsAnswerer(requesterId);
            return;
          }

          this.sendConnectResponse(requesterId, false, "wrong-code");
          return;
        }

        if (appState.connectedPeerId) {
          this.sendConnectResponse(requesterId, false, "busy");
          return;
        }

        if (appState.connectingPeerId === requesterId) {
          this.handleMutualConnect(requesterId);
          return;
        }

        if (appState.connectingPeerId || appState.pendingRequest) {
          this.sendConnectResponse(requesterId, false, "busy");
          return;
        }

        logger.log(`(Room) connect-request pending modal for ${requesterId}`);
        appState.pendingRequest = message.requester;
        appState.connectionModalOpen = true;
      },
      onConnectResponse: async (message: { accepted: boolean; targetPeerId: string }) => {
        logger.log(
          `(Room) connect-response ← ${message.targetPeerId} ${message.accepted ? "accepted" : "rejected"}`,
        );
        if (!message.accepted) {
          if (appState.connectingPeerId === message.targetPeerId) {
            if (appState.roomJoinOpen) {
              if (appState.roomJoinMode === "auto") {
                this.unlockRoomJoin("Código incorreto", "error");
              } else {
                this.unlockRoomJoin("Conexão recusada", "warning");
              }
              return;
            }
            toastStore.showToast("Conexão recusada", "warning");
            appState.connectingPeerId = null;
            appState.connectedPeerInfo = null;
          }
          return;
        }

        if (appState.connectingPeerId !== message.targetPeerId) return;

        if (this.peerConnection && this.activeTargetPeerId === message.targetPeerId) return;

        await this.beginAsOfferer(message.targetPeerId);
      },
      onSdpOffer: async (message: { fromPeerId: string; sdp: RTCSessionDescriptionInit }) => {
        if (!this.peerConnection || this.activeTargetPeerId !== message.fromPeerId) {
          this.setupPeerConnection(false, message.fromPeerId);
        }
        const answer = await this.peerConnection!.handleOffer(message.sdp);
        this.signaling.send({
          type: "sdp-answer",
          targetPeerId: message.fromPeerId,
          sdp: answer,
        });
      },
      onSdpAnswer: async (message: { sdp: RTCSessionDescriptionInit }) => {
        await this.peerConnection?.handleAnswer(message.sdp);
      },
      onIceCandidate: async (message: { fromPeerId: string; candidate: RTCIceCandidateInit }) => {
        if (this.activeTargetPeerId !== message.fromPeerId) return;
        await this.peerConnection?.addIceCandidate(message.candidate);
      },
      onClose: (intentional: boolean) => {
        if (intentional || appState.connectedPeerId) return;
        if (!this.signalingDisconnectNotified) {
          this.signalingDisconnectNotified = true;
          toastStore.showToast("Desconectado do servidor de emparelhamento", "warning");
        }
      },
    });
  }

  handlePageUnload() {
    this.transferManager?.abort();
    this.transferManager = null;
    this.disposePeerConnection();
  }

  destroy() {
    this.transferManager?.abort();
    this.transferManager = null;
    this.signaling.disconnect();
    this.disposePeerConnection();
    this.clearRoomJoinTimers();
    appState.roomJoinOpen = false;
    appState.roomJoinPhase = "waiting";
    appState.roomJoinMode = null;
    appState.roomJoinCode = null;
    appState.roomJoinTargetPeerId = null;
    if (this.queueNotifyDelayTimeout) {
      clearTimeout(this.queueNotifyDelayTimeout);
      this.queueNotifyDelayTimeout = null;
    }
  }
}

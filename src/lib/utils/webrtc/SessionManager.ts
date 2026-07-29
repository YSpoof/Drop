import { appState } from "$lib/stores/appState.svelte";
import { toastStore } from "$lib/stores/toast.svelte";
import type { QueuedFile } from "$lib/utils/files/queue";
import { abortAllDownloadStreams } from "$lib/utils/files/swDownload";
import type { BatchDoneInfo, HistoryEntry } from "$lib/utils/files/transferTypes";
import { localForage } from "$lib/utils/localForage";
import { SignalingClient } from "$lib/utils/signaling/client";
import type { PeerInfo } from "$lib/utils/signaling/types";
import { resolveChunkSize } from "$lib/utils/webrtc/chunkSize";
import { discoverLocalIps } from "$lib/utils/webrtc/discovery";
import { PeerConnection } from "$lib/utils/webrtc/peer";
import {
  TransferManager,
  type TransferProgress as TransferProgressState,
} from "$lib/utils/webrtc/transfer";

const AUTO_KEY_STORAGE_KEY = "autoKey";

type PendingBatchCompletion = {
  direction: HistoryEntry["direction"];
  succeeded: string[];
  fileCountInBatch: number;
};

export type SessionRoomAccessors = {
  getRoom: () => string | undefined;
};

export class SessionManager {
  private readonly signaling = new SignalingClient();
  private peerConnection: PeerConnection | null = null;
  private transferManager: TransferManager | null = null;
  private activeTargetPeerId: string | null = null;
  private peerDisconnectHandled = false;
  private signalingDisconnectNotified = false;
  private queueNotifyDelayTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingBatchCompletions = new Map<string, PendingBatchCompletion>();
  private readonly getRoom: () => string | undefined;

  constructor(accessors: SessionRoomAccessors) {
    this.getRoom = accessors.getRoom;
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
    this.signaling.announce({
      type: "announce",
      peerId: appState.identity.peerId,
      displayName: appState.displayName,
      deviceHint: appState.identity.deviceHint,
      room: this.getRoom(),
      localIps: appState.localIps,
      hasAutoKey: !!appState.autoKey,
    });
  }

  handleDisplayNameBlur() {
    appState.handleDisplayNameBlur();
    this.announce();
  }

  addFiles(files: FileList | File[] | { file: File; path: string }[]) {
    const newItems = appState.createAndQueue(files);

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

    appState.upsertTransfer({ ...item, status: "in-progress", bytesTransferred: 0 });
    this.transferManager?.requestPull(fileId);
  }

  handlePullBatch(fileIds: string[], zipFilename?: string) {
    const pendingIds = appState.pendingReceivedIds(fileIds);
    if (!pendingIds.length) return;

    for (const id of pendingIds) {
      const item = appState.transfers.find((entry) => entry.id === id)!;
      appState.upsertTransfer({ ...item, status: "in-progress", bytesTransferred: 0 });
    }
    this.transferManager?.requestPullBatch(pendingIds, zipFilename);
  }

  setManualDownload(manual: boolean) {
    this.transferManager?.setManualDownload(manual);
  }

  private suspendSignaling() {
    this.signaling.suspend();
    appState.peers = [];
  }

  private async resumeSignaling() {
    this.signaling.resume();
  }

  private cleanupPeerConnection() {
    if (this.peerDisconnectHandled) return;
    this.peerDisconnectHandled = true;

    appState.resetTransferState();
    this.clearPendingBatchCompletions();
    this.transferManager?.abort();
    this.transferManager = null;

    appState.connectedPeerId = null;
    appState.connectedPeerInfo = null;
    appState.connectingPeerId = null;
    this.activeTargetPeerId = null;

    const pc = this.peerConnection;
    this.peerConnection = null;
    if (pc) {
      pc.onConnectionStateChange = null;
      pc.close();
    }

    toastStore.showToast("Desconectado", "info");
    void this.resumeSignaling();
  }

  private handlePeerDisconnect() {
    this.cleanupPeerConnection();
  }

  disconnectPeer() {
    abortAllDownloadStreams();
    this.transferManager?.sendBye();
    this.cleanupPeerConnection();
  }

  private attachDataChannel(channel: RTCDataChannel, targetPeerId: string, offerer: boolean) {
    channel.onopen = () => {
      const peerInfo = this.findPeer(targetPeerId);
      if (peerInfo) appState.connectedPeerInfo = peerInfo;

      appState.connectedPeerId = targetPeerId;
      appState.connectingPeerId = null;
      this.peerDisconnectHandled = false;
      toastStore.showToast("Conectado", "success");
      this.suspendSignaling();

      let chunkSize: number;
      try {
        const sctp = this.peerConnection?.pc.sctp ?? null;
        chunkSize = resolveChunkSize(sctp);
      } catch {
        toastStore.showToast("Conexão incompatível com este navegador", "error");
        this.cleanupPeerConnection();
        return;
      }

      this.transferManager = new TransferManager(channel, chunkSize, {
        isOfferer: offerer,
        getSendQueue: () => appState.queue,
        onBye: () => {
          this.cleanupPeerConnection();
        },
        onChunkBytes: (direction, bytes) => {
          appState.recordTransferStats(direction === "send" ? "sent" : "received", bytes);
        },
        onProgress: (progress: TransferProgressState) => {
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
        },
        onHistory: (entry) => {
          appState.upsertTransfer({
            id: entry.id,
            name: entry.name,
            size: entry.size,
            direction: entry.direction,
            status: entry.status === "failed" ? "failed" : "completed",
            bytesTransferred: entry.size,
          });

          this.handleHistoryToast(entry);
        },
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

    channel.onclose = () => {
      this.handlePeerDisconnect();
    };
  }

  /**
   * Orchestrates the creation of a WebRTC PeerConnection, configuring ICE candidate exchange
   * via signaling, and preparing the underlying SCTP data channel for file transfer.
   */
  private setupPeerConnection(offerer: boolean, targetPeerId: string) {
    const previous = this.peerConnection;
    this.peerConnection = null;
    if (previous) {
      previous.onConnectionStateChange = null;
      previous.close();
    }

    this.peerDisconnectHandled = false;
    this.activeTargetPeerId = targetPeerId;
    this.peerConnection = new PeerConnection(offerer);

    this.peerConnection.onIceCandidate = (candidate) => {
      this.signaling.send({
        type: "ice-candidate",
        targetPeerId,
        candidate: candidate.toJSON(),
      });
    };

    this.peerConnection.onDataChannel = (channel) => {
      this.attachDataChannel(channel, targetPeerId, offerer);
    };

    this.peerConnection.onConnectionStateChange = (state) => {
      if (state === "failed" || state === "disconnected" || state === "closed") {
        this.handlePeerDisconnect();
      }
    };

    this.peerConnection.prepareChannel();
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
    this.signaling.send({
      type: "connect-response",
      targetPeerId: requesterPeerId,
      accepted: true,
    });

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

    this.signaling.send({
      type: "connect-response",
      targetPeerId: requester.peerId,
      accepted: true,
    });
    this.beginAsAnswerer(requester.peerId);
  }

  denyPendingRequest() {
    if (!appState.pendingRequest) return;
    const requester = appState.pendingRequest;
    this.clearPendingRequest();

    this.signaling.send({
      type: "connect-response",
      targetPeerId: requester.peerId,
      accepted: false,
    });
  }

  handleConnect(targetPeerId: string) {
    if (appState.connectingPeerId || appState.connectedPeerId) return;
    appState.connectingPeerId = targetPeerId;
    const peerInfo = this.findPeer(targetPeerId);
    if (peerInfo) appState.connectedPeerInfo = peerInfo;
    toastStore.showToast("Solicitando conexão…", "info");
    this.signaling.send({ type: "connect-request", targetPeerId });
  }

  private generateAutoKey(): string {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return String(bytes[0]! % 1_000_000).padStart(6, "0");
  }

  async copyAutoKey() {
    if (!appState.autoKey) return;
    try {
      await navigator.clipboard.writeText(appState.autoKey);
      toastStore.showToast("Chave copiada", "success");
    } catch {
      toastStore.showToast("Não foi possível copiar a chave", "error");
    }
  }

  async handleAutoKeyClick() {
    if (appState.autoKey) {
      appState.autoKey = null;
      appState.autoKeyModalOpen = false;
      this.announce();
      toastStore.showToast("Auto-conexão desativada", "info");
      return;
    }

    const stored = await localForage.getItem<string>(AUTO_KEY_STORAGE_KEY);
    const key = stored ?? this.generateAutoKey();
    if (!stored) {
      await localForage.setItem(AUTO_KEY_STORAGE_KEY, key);
    }
    appState.autoKey = key;
    this.announce();
    appState.autoKeyModalOpen = true;
  }

  async regenerateAutoKey() {
    const key = this.generateAutoKey();
    await localForage.setItem(AUTO_KEY_STORAGE_KEY, key);
    appState.autoKey = key;
    this.announce();
    toastStore.showToast("Nova chave gerada", "success");
  }

  handleAutoKeyModalClose() {
    appState.autoKeyModalOpen = false;
  }

  handleAutoConnectClick(targetPeerId: string) {
    const peerInfo = this.findPeer(targetPeerId);
    if (!peerInfo) return;
    appState.enterKeyPeer = peerInfo;
    appState.enterKeyModalOpen = true;
  }

  handleEnterKeyModalClose() {
    appState.enterKeyModalOpen = false;
    setTimeout(() => {
      appState.enterKeyPeer = null;
    }, 300);
  }

  handleEnterKeyNoKey() {
    if (!appState.enterKeyPeer) return;
    const targetPeerId = appState.enterKeyPeer.peerId;
    this.handleConnect(targetPeerId);
  }

  handleEnterKeySubmit(key: string) {
    if (!appState.enterKeyPeer) return;
    const targetPeerId = appState.enterKeyPeer.peerId;
    appState.enterKeyModalOpen = false;
    setTimeout(() => {
      appState.enterKeyPeer = null;
    }, 300);

    if (appState.connectingPeerId || appState.connectedPeerId) return;
    appState.connectingPeerId = targetPeerId;
    const peerInfo = this.findPeer(targetPeerId);
    if (peerInfo) appState.connectedPeerInfo = peerInfo;
    toastStore.showToast("Conectando com chave…", "info");
    this.signaling.send({ type: "connect-request", targetPeerId, autoKey: key });
  }

  async joinSignaling() {
    appState.localIps = appState.localIps.length > 0 ? appState.localIps : await discoverLocalIps();
    this.announce();
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
      },
      onConnectRequest: (message: { requester: PeerInfo; autoKey?: string }) => {
        const requesterId = message.requester.peerId;

        if (message.autoKey) {
          if (appState.autoKey && message.autoKey === appState.autoKey) {
            if (appState.connectedPeerId || appState.connectingPeerId || appState.pendingRequest) {
              this.signaling.send({
                type: "connect-response",
                targetPeerId: requesterId,
                accepted: false,
              });
              return;
            }

            const peerInfo = this.findPeer(requesterId) ?? message.requester;
            appState.connectedPeerInfo = peerInfo;

            this.signaling.send({
              type: "connect-response",
              targetPeerId: requesterId,
              accepted: true,
            });
            this.beginAsAnswerer(requesterId);
            return;
          }

          this.signaling.send({
            type: "connect-response",
            targetPeerId: requesterId,
            accepted: false,
          });
          return;
        }

        if (appState.connectedPeerId) {
          this.signaling.send({
            type: "connect-response",
            targetPeerId: requesterId,
            accepted: false,
          });
          return;
        }

        if (appState.connectingPeerId === requesterId) {
          this.handleMutualConnect(requesterId);
          return;
        }

        if (appState.connectingPeerId || appState.pendingRequest) {
          this.signaling.send({
            type: "connect-response",
            targetPeerId: requesterId,
            accepted: false,
          });
          return;
        }

        appState.pendingRequest = message.requester;
        appState.connectionModalOpen = true;
      },
      onConnectResponse: async (message: { accepted: boolean; targetPeerId: string }) => {
        if (!message.accepted) {
          if (appState.connectingPeerId === message.targetPeerId) {
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

    const pc = this.peerConnection;
    this.peerConnection = null;
    if (pc) {
      pc.onConnectionStateChange = null;
      pc.close();
    }
  }

  destroy() {
    this.transferManager?.abort();
    this.transferManager = null;
    this.signaling.disconnect();
    this.peerConnection?.close();
    if (this.queueNotifyDelayTimeout) {
      clearTimeout(this.queueNotifyDelayTimeout);
      this.queueNotifyDelayTimeout = null;
    }
  }
}

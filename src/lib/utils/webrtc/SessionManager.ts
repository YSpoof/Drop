import { appState } from "$lib/stores/appState.svelte";
import type { QueuedFile } from "$lib/utils/files/queue";
import { logger } from "$lib/utils/logger";
import { SignalingClient } from "$lib/utils/signaling/client";
import type { ClientMessage } from "$lib/utils/signaling/types";
import { discoverLocalIps } from "$lib/utils/webrtc/discovery";
import { PeerSessionCoordinator } from "$lib/utils/webrtc/peerSession";
import { QueueCoordinator } from "$lib/utils/webrtc/queueCoordinator";
import { RoomJoinController } from "$lib/utils/webrtc/roomJoin";
import { createSignalingHandlers } from "$lib/utils/webrtc/signalingHandlers";
import { TransferOrchestrator } from "$lib/utils/webrtc/transferOrchestrator";

let activeSession: SessionManager | null = null;

export function registerSession(session: SessionManager): void {
  activeSession = session;
}

export function unregisterSession(session: SessionManager): void {
  if (activeSession === session) activeSession = null;
}

export function abortActiveSession(): void {
  activeSession?.handlePageUnload();
}

export type SessionRoomAccessors = {
  getRoom: () => string | undefined;
  getRoomCode: () => string | undefined;
};

export class SessionManager {
  private readonly signaling = new SignalingClient();
  private readonly transferOrchestrator = new TransferOrchestrator();
  private readonly peerSession: PeerSessionCoordinator;
  private readonly roomJoin: RoomJoinController;
  private readonly queue: QueueCoordinator;
  private signalingDisconnectNotified = false;
  private readonly getRoom: () => string | undefined;
  private readonly getRoomCode: () => string | undefined;

  constructor(accessors: SessionRoomAccessors) {
    this.getRoom = accessors.getRoom;
    this.getRoomCode = accessors.getRoomCode;

    const signalingBridge = {
      send: (message: ClientMessage) => this.signaling.send(message),
      suspend: () => this.signaling.suspend(),
      resume: () => this.signaling.resume(),
    };

    let peerSession!: PeerSessionCoordinator;
    this.roomJoin = new RoomJoinController(signalingBridge, {
      disposePeerConnection: (options) => peerSession.disposePeerConnection(options),
      hasPeerConnection: () => peerSession.hasPeerConnection(),
    });

    peerSession = new PeerSessionCoordinator({
      signaling: signalingBridge,
      transferOrchestrator: this.transferOrchestrator,
      roomJoin: this.roomJoin,
      findPeer: (peerId) => this.findPeer(peerId),
      getRoomCode: () => this.getRoomCode(),
    });
    this.peerSession = peerSession;
    this.queue = new QueueCoordinator(() => this.peerSession.getTransferManager());
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
    this.queue.addFiles(files);
  }

  appendQueuedFiles(items: QueuedFile[]) {
    this.queue.appendQueuedFiles(items);
  }

  notifyQueueChanged() {
    this.queue.notifyQueueChanged();
  }

  clearQueue() {
    this.queue.clearQueue();
  }

  handleDeleteTransfer(fileId: string | string[]) {
    this.queue.handleDeleteTransfer(fileId);
  }

  handlePull(fileId: string) {
    this.queue.handlePull(fileId);
  }

  handlePullBatch(fileIds: string[], zipFilename?: string) {
    this.queue.handlePullBatch(fileIds, zipFilename);
  }

  setManualDownload(manual: boolean) {
    this.peerSession.setManualDownload(manual);
  }

  disconnectPeer() {
    this.peerSession.disconnectPeer();
  }

  acceptPendingRequest() {
    this.peerSession.acceptPendingRequest();
  }

  denyPendingRequest() {
    this.peerSession.denyPendingRequest();
  }

  handleConnect(targetPeerId: string) {
    this.peerSession.handleConnect(targetPeerId);
  }

  generateRoomCode() {
    return this.roomJoin.generateRoomCode();
  }

  startRoomJoin(mode: "auto" | "ask", code?: string) {
    this.roomJoin.startRoomJoin(mode, code);
  }

  finishRoomJoinSuccess() {
    this.roomJoin.finishRoomJoinSuccess();
  }

  unlockRoomJoin(message?: string, type: "error" | "warning" | "info" | "success" = "error") {
    this.roomJoin.unlockRoomJoin(message, type);
  }

  cancelRoomJoin() {
    this.roomJoin.cancelRoomJoin();
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
    this.signaling.connect(
      createSignalingHandlers({
        signaling: this.signaling,
        peerSession: this.peerSession,
        roomJoin: this.roomJoin,
        findPeer: (peerId) => this.findPeer(peerId),
        getRoomCode: () => this.getRoomCode(),
        joinSignaling: () => this.joinSignaling(),
        clearPendingRequest: () => this.clearPendingRequest(),
        getSignalingDisconnectNotified: () => this.signalingDisconnectNotified,
        setSignalingDisconnectNotified: (value) => {
          this.signalingDisconnectNotified = value;
        },
      }),
    );
  }

  handlePageUnload() {
    this.peerSession.handlePageUnload();
  }

  destroy() {
    this.peerSession.abort();
    this.signaling.disconnect();
    this.peerSession.disposePeerConnection();
    this.roomJoin.destroy();
    this.queue.destroy();
  }
}

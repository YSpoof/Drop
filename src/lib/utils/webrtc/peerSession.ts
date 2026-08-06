import { appState } from "$lib/stores/appState.svelte";
import { toastStore } from "$lib/stores/toast.svelte";
import { abortAllDownloadStreams } from "$lib/utils/files/swDownload";
import { logger } from "$lib/utils/logger";
import type { ClientMessage, PeerInfo } from "$lib/utils/signaling/types";
import { PeerConnection } from "$lib/utils/webrtc/peer";
import type { RoomJoinController } from "$lib/utils/webrtc/roomJoin";
import type { TransferManager } from "$lib/utils/webrtc/transfer";
import { TransferOrchestrator } from "$lib/utils/webrtc/transferOrchestrator";

export type PeerSessionSignaling = {
  send: (message: ClientMessage) => void;
  suspend: () => void;
  resume: () => void | Promise<void>;
};

export type PeerSessionDeps = {
  signaling: PeerSessionSignaling;
  transferOrchestrator: TransferOrchestrator;
  roomJoin: RoomJoinController;
  findPeer: (peerId: string) => PeerInfo | undefined;
  getRoomCode: () => string | undefined;
};

export class PeerSessionCoordinator {
  private peerConnection: PeerConnection | null = null;
  private transferManager: TransferManager | null = null;
  private activeTargetPeerId: string | null = null;
  private peerDisconnectHandled = false;

  constructor(private readonly deps: PeerSessionDeps) {}

  getTransferManager() {
    return this.transferManager;
  }

  hasPeerConnection() {
    return this.peerConnection !== null;
  }

  setManualDownload(manual: boolean) {
    this.transferManager?.setManualDownload(manual);
  }

  suspendSignaling() {
    logger.log("(Room) suspend");
    this.deps.signaling.suspend();
    appState.peers = [];
  }

  resumeSignaling() {
    logger.log("(Room) resume");
    this.deps.signaling.resume();
  }

  sendConnectResponse(targetPeerId: string, accepted: boolean, reason?: string) {
    logger.log(
      `(Room) connect-response → ${targetPeerId} ${accepted ? "accepted" : "rejected"}${reason ? ` (${reason})` : ""}`,
    );
    this.deps.signaling.send({ type: "connect-response", targetPeerId, accepted });
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
    const peerInfo = this.deps.findPeer(targetPeerId);
    if (peerInfo) appState.connectedPeerInfo = peerInfo;
    toastStore.showToast("Solicitando conexão…", "info");
    const roomCode = this.deps.getRoomCode();
    if (roomCode) {
      this.deps.signaling.send({ type: "connect-request", targetPeerId, roomCode });
    } else {
      this.deps.signaling.send({ type: "connect-request", targetPeerId });
    }
  }

  handleMutualConnect(requesterPeerId: string) {
    logger.log(`(Room) mutual connect with ${requesterPeerId}`);
    this.sendConnectResponse(requesterPeerId, true);

    if (this.isOfferer(requesterPeerId)) {
      void this.beginAsOfferer(requesterPeerId);
    } else {
      this.beginAsAnswerer(requesterPeerId);
    }
  }

  beginAsAnswerer(requesterPeerId: string) {
    const peerInfo =
      this.deps.findPeer(requesterPeerId) ??
      (appState.pendingRequest?.peerId === requesterPeerId
        ? appState.pendingRequest
        : appState.connectedPeerInfo);
    if (peerInfo) appState.connectedPeerInfo = peerInfo;
    this.setupPeerConnection(false, requesterPeerId);
  }

  async beginAsOfferer(targetPeerId: string) {
    this.setupPeerConnection(true, targetPeerId);
    await this.sendOffer(targetPeerId);
  }

  async handleSdpOffer(fromPeerId: string, sdp: RTCSessionDescriptionInit) {
    if (!this.peerConnection || this.activeTargetPeerId !== fromPeerId) {
      this.setupPeerConnection(false, fromPeerId);
    }
    const answer = await this.peerConnection!.handleOffer(sdp);
    this.deps.signaling.send({
      type: "sdp-answer",
      targetPeerId: fromPeerId,
      sdp: answer,
    });
  }

  async handleSdpAnswer(sdp: RTCSessionDescriptionInit) {
    await this.peerConnection?.handleAnswer(sdp);
  }

  async handleIceCandidate(fromPeerId: string, candidate: RTCIceCandidateInit) {
    if (this.activeTargetPeerId !== fromPeerId) return;
    await this.peerConnection?.addIceCandidate(candidate);
  }

  shouldSkipConnectResponse(targetPeerId: string) {
    return this.peerConnection !== null && this.activeTargetPeerId === targetPeerId;
  }

  disconnectPeer() {
    abortAllDownloadStreams();
    this.transferManager?.sendBye();
    this.cleanupPeerConnection();
  }

  handlePageUnload() {
    this.transferManager?.abort();
    this.transferManager = null;
    this.disposePeerConnection();
  }

  abort() {
    this.transferManager?.abort();
    this.transferManager = null;
  }

  disposePeerConnection(options?: { markHandled?: boolean }) {
    if (options?.markHandled) this.peerDisconnectHandled = true;
    const pc = this.peerConnection;
    this.peerConnection = null;
    this.activeTargetPeerId = null;
    this.closePeerHandle(pc);
  }

  private clearPendingRequest() {
    appState.connectionModalOpen = false;
    setTimeout(() => {
      appState.pendingRequest = null;
    }, 300);
  }

  private isOfferer(peerId: string) {
    return appState.identity.peerId < peerId;
  }

  private async sendOffer(targetPeerId: string) {
    if (!this.peerConnection) return;
    const offer = await this.peerConnection.createOffer();
    this.deps.signaling.send({
      type: "sdp-offer",
      targetPeerId,
      sdp: offer,
    });
  }

  private setupPeerConnection(offerer: boolean, targetPeerId: string) {
    const previous = this.peerConnection;
    this.peerConnection = null;
    this.closePeerHandle(previous);

    this.peerDisconnectHandled = false;
    this.activeTargetPeerId = targetPeerId;
    this.peerConnection = new PeerConnection();

    this.peerConnection.onIceCandidate = (candidate) => {
      this.deps.signaling.send({
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

  private attachDataChannels(targetPeerId: string, offerer: boolean) {
    const peer = this.peerConnection;
    if (!peer) return;

    const { controlChannel: control, filesChannel: files } = peer;
    let started = false;

    const tryStart = () => {
      if (started) return;
      if (control.readyState !== "open" || files.readyState !== "open") return;
      started = true;

      const peerInfo = this.deps.findPeer(targetPeerId);
      if (peerInfo) appState.connectedPeerInfo = peerInfo;

      appState.connectedPeerId = targetPeerId;
      appState.connectingPeerId = null;
      this.peerDisconnectHandled = false;
      logger.log("(Room) peer connect");

      if (appState.roomJoinOpen) {
        this.deps.roomJoin.onPeerConnected();
      } else {
        toastStore.showToast("Conectado", "success");
      }
      this.suspendSignaling();

      this.transferManager = this.deps.transferOrchestrator.startTransferManager(
        peer,
        offerer,
        () => {
          toastStore.showToast("Conexão incompatível com este navegador", "error");
          this.cleanupPeerConnection();
        },
        () => this.cleanupPeerConnection(),
      );
    };

    for (const channel of [control, files]) {
      channel.onopen = () => tryStart();
      channel.onclose = () => this.handlePeerDisconnect();
      if (channel.readyState === "open") tryStart();
    }
  }

  private handlePeerDisconnect() {
    this.cleanupPeerConnection();
  }

  private cleanupPeerConnection() {
    if (this.peerDisconnectHandled) return;
    this.peerDisconnectHandled = true;

    logger.log("(Room) peer disconnect");

    const roomJoinConnecting = appState.roomJoinOpen && appState.roomJoinPhase === "connecting";

    appState.resetTransferState();
    this.deps.transferOrchestrator.clearPendingBatchCompletions();
    this.transferManager?.abort();
    this.transferManager = null;

    appState.connectedPeerId = null;
    appState.connectedPeerInfo = null;
    appState.connectingPeerId = null;
    this.activeTargetPeerId = null;

    this.closePeerHandle(this.peerConnection);
    this.peerConnection = null;

    if (roomJoinConnecting) {
      this.deps.roomJoin.onPeerDisconnectWhileConnecting();
      return;
    }

    this.deps.roomJoin.onPeerDisconnectCleanup();
    toastStore.showToast("Desconectado", "info");
    void this.resumeSignaling();
  }

  private closePeerHandle(pc: PeerConnection | null) {
    if (!pc) return;
    pc.onConnectionStateChange = null;
    pc.close();
  }
}

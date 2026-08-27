import { downloadService, fileLockManager, transferService } from "#lib/runtime.js";
import { peerStore } from "#lib/stores/peerStore.svelte.js";
import { toastStore } from "#lib/stores/toast.svelte.js";
import { transferStore } from "#lib/stores/transferStore.svelte.js";
import { uiStore } from "#lib/stores/uiStore.svelte.js";
import { logger } from "#lib/utils/logger.js";
import type { SignalingClient } from "#lib/utils/signaling/client.js";
import type { IceMode } from "#lib/utils/signaling/types.js";
import type { CodeJoinController } from "#lib/utils/webrtc/codeJoin.js";
import { PeerConnection } from "#lib/utils/webrtc/peer.js";
import type { TransferManager } from "#lib/utils/webrtc/transfer.js";

const LOCAL_ICE_TIMEOUT_MS = 3_000;
const LOCAL_ICE_TRIES = 3;
const RESUME_AFTER_DISCONNECT_MS = 2_000;

export type PeerSessionDeps = {
  signaling: SignalingClient;
  codeJoin: CodeJoinController;
};

export class PeerSessionCoordinator {
  private peerConnection: PeerConnection | null = null;
  private transferManager: TransferManager | null = null;
  private activeTargetPeerId: string | null = null;
  private peerDisconnectHandled = false;
  private iceLan = false;
  private iceMode: IceMode = "all";
  private localAttempt = 0;
  private iceRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastConnectedPeerId: string | null = null;

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

  setIceLan(lan: boolean) {
    this.iceLan = lan;
  }

  beginAsAnswerer(requesterPeerId: string) {
    this.prepareIce();
    this.setupPeerConnection(false, requesterPeerId);
  }

  async beginAsOfferer(targetPeerId: string) {
    this.prepareIce();
    this.setupPeerConnection(true, targetPeerId);
    await this.sendOffer(targetPeerId);
    this.armIceRetry();
  }

  async handleSdpOffer(
    fromPeerId: string,
    sdp: RTCSessionDescriptionInit,
    iceMode: IceMode = "all",
  ) {
    this.iceMode = iceMode;
    this.setupPeerConnection(false, fromPeerId);
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

  disconnectPeer() {
    downloadService.abortAll();
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
    this.clearIceRetry();
    const pc = this.peerConnection;
    this.peerConnection = null;
    this.activeTargetPeerId = null;
    this.closePeerHandle(pc);
  }

  private prepareIce() {
    this.iceMode = this.iceLan ? "local" : "all";
    this.localAttempt = this.iceLan ? 1 : 0;
  }

  private armIceRetry() {
    this.clearIceRetry();
    if (this.iceMode !== "local") return;
    this.iceRetryTimer = setTimeout(() => {
      this.iceRetryTimer = null;
      this.retryIce();
    }, LOCAL_ICE_TIMEOUT_MS);
  }

  private clearIceRetry() {
    if (!this.iceRetryTimer) return;
    clearTimeout(this.iceRetryTimer);
    this.iceRetryTimer = null;
  }

  private retryIce() {
    if (peerStore.connectedPeerId) return;
    const target = this.activeTargetPeerId;
    if (!target) return;

    if (this.iceMode === "local" && this.localAttempt < LOCAL_ICE_TRIES) {
      this.localAttempt += 1;
    } else {
      this.iceMode = "all";
    }

    logger.log(`(Share) ICE retry mode=${this.iceMode} attempt=${this.localAttempt}`);
    this.setupPeerConnection(true, target);
    void this.sendOffer(target);
    this.armIceRetry();
  }

  private async sendOffer(targetPeerId: string) {
    if (!this.peerConnection) return;
    const offer = await this.peerConnection.createOffer();
    this.deps.signaling.send({
      type: "sdp-offer",
      targetPeerId,
      sdp: offer,
      iceMode: this.iceMode,
    });
  }

  private setupPeerConnection(offerer: boolean, targetPeerId: string) {
    this.transferManager?.abort();
    this.transferManager = null;
    transferStore.resetTransferState();

    const previous = this.peerConnection;
    this.peerConnection = null;
    this.closePeerHandle(previous);

    this.peerDisconnectHandled = false;
    this.activeTargetPeerId = targetPeerId;
    this.peerConnection = new PeerConnection(this.iceMode);

    this.peerConnection.onIceCandidate = (candidate) => {
      this.deps.signaling.send({
        type: "ice-candidate",
        targetPeerId,
        candidate: candidate.toJSON(),
      });
    };

    this.peerConnection.onConnectionStateChange = (state) => {
      if (this.iceMode === "local" && this.iceRetryTimer) return;
      if (state === "failed" || state === "disconnected" || state === "closed") {
        this.cleanupPeerConnection();
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

      this.clearIceRetry();

      peerStore.connectedPeerId = targetPeerId;
      peerStore.connectingPeerId = null;
      peerStore.connectedViaLan = this.iceMode === "local";
      this.peerDisconnectHandled = false;
      logger.log(`(Share) peer connect iceMode=${this.iceMode}`);

      if (uiStore.codeJoinOpen) {
        this.deps.codeJoin.onPeerConnected();
      } else {
        toastStore.showToast("Conectado", "success");
      }
      this.deps.signaling.suspend();

      void this.startTransfers(targetPeerId, offerer);
    };

    for (const channel of [control, files]) {
      channel.onopen = () => tryStart();
      channel.onclose = () => this.cleanupPeerConnection();
      if (channel.readyState === "open") tryStart();
    }
  }

  private async startTransfers(targetPeerId: string, offerer: boolean) {
    const peer = this.peerConnection;
    if (!peer) return;

    if (this.lastConnectedPeerId && this.lastConnectedPeerId !== targetPeerId) {
      await downloadService.dropIncomplete();
    }
    if (this.peerConnection !== peer) return;
    this.lastConnectedPeerId = targetPeerId;

    this.transferManager = transferService.startTransferManager(
      peer,
      offerer,
      () => {
        toastStore.showToast("Conexão incompatível com este navegador", "error");
        this.cleanupPeerConnection();
      },
      () => this.cleanupPeerConnection(),
      (fileId) => void fileLockManager.unlock(fileId),
      (fileId) => void fileLockManager.unlock(fileId),
    );
  }

  private cleanupPeerConnection() {
    if (this.peerDisconnectHandled) return;
    this.peerDisconnectHandled = true;
    this.clearIceRetry();

    logger.log("(Share) peer disconnect");

    const joinConnecting = uiStore.codeJoinOpen && peerStore.codeJoinPhase === "connecting";

    transferStore.resetTransferState();
    transferService.clearPendingBatchCompletions();
    this.transferManager?.abort();
    this.transferManager = null;

    peerStore.connectedPeerId = null;
    peerStore.connectedPeerInfo = null;
    peerStore.connectingPeerId = null;
    peerStore.connectedViaLan = false;
    this.activeTargetPeerId = null;
    this.iceLan = false;
    this.iceMode = "all";
    this.localAttempt = 0;

    this.closePeerHandle(this.peerConnection);
    this.peerConnection = null;

    if (joinConnecting) {
      this.deps.codeJoin.fail("Falha na conexão");
      return;
    }

    this.deps.codeJoin.onPeerDisconnectCleanup();
    toastStore.showToast("Desconectado", "info");
    this.deps.signaling.resume(RESUME_AFTER_DISCONNECT_MS);
  }

  private closePeerHandle(pc: PeerConnection | null) {
    if (!pc) return;
    pc.onConnectionStateChange = null;
    pc.onIceCandidate = null;
    pc.controlChannel.onopen = null;
    pc.controlChannel.onclose = null;
    pc.filesChannel.onopen = null;
    pc.filesChannel.onclose = null;
    pc.close();
  }
}

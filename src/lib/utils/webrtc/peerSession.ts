import { FastRTC, type Channel, type Peer, type SignalPayload } from "fastrtc";

import { downloadService, fileLockManager, transferService } from "#lib/runtime.js";
import { deviceStore } from "#lib/stores/deviceStore.svelte.js";
import { peerStore } from "#lib/stores/peerStore.svelte.js";
import { toastStore } from "#lib/stores/toast.svelte.js";
import { transferStore } from "#lib/stores/transferStore.svelte.js";
import { uiStore } from "#lib/stores/uiStore.svelte.js";
import { logger } from "#lib/utils/logger.js";
import type { SignalingClient } from "#lib/utils/signaling/client.js";
import type { CodeJoinController } from "#lib/utils/webrtc/codeJoin.js";
import type { TransferManager } from "#lib/utils/webrtc/transfer.js";

const RESUME_AFTER_DISCONNECT_MS = 2_000;
const CTRL_LABEL = "ctrl";
const FILES_LABEL = "files";

export type PeerSessionDeps = {
  signaling: SignalingClient;
  codeJoin: CodeJoinController;
};

export class PeerSessionCoordinator {
  private rtc: FastRTC | null = null;
  private transferManager: TransferManager | null = null;
  private activeTargetPeerId: string | null = null;
  private peerDisconnectHandled = false;
  private pendingLan = false;
  private lastConnectedPeerId: string | null = null;
  private channelsStarted = false;
  private ctrl: Channel | null = null;
  private files: Channel | null = null;
  private stopRtcEvents: (() => void) | null = null;
  private stopChannelClose: (() => void) | null = null;

  constructor(private readonly deps: PeerSessionDeps) {}

  getTransferManager() {
    return this.transferManager;
  }

  hasPeerConnection() {
    return this.rtc !== null;
  }

  setManualDownload(manual: boolean) {
    this.transferManager?.setManualDownload(manual);
  }

  connectPeer(targetPeerId: string, lan = false) {
    this.pendingLan = lan;
    this.setupRtc(targetPeerId);
    this.onPeerReady(this.rtc!.connect(targetPeerId));
  }

  handleSignal(fromPeerId: string, payload: SignalPayload) {
    if (this.activeTargetPeerId && this.activeTargetPeerId !== fromPeerId) return;
    this.setupRtc(fromPeerId);
    this.onPeerReady(this.rtc!.receive(fromPeerId, payload));
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
    const handled = options?.markHandled ?? false;
    this.peerDisconnectHandled = true;
    const rtc = this.rtc;
    this.rtc = null;
    this.activeTargetPeerId = null;
    this.ctrl = null;
    this.files = null;
    this.channelsStarted = false;
    this.stopRtcEvents?.();
    this.stopChannelClose?.();
    this.stopRtcEvents = null;
    this.stopChannelClose = null;
    rtc?.dispose();
    this.peerDisconnectHandled = handled;
  }

  private setupRtc(targetPeerId: string) {
    if (this.rtc && this.activeTargetPeerId === targetPeerId) return;

    this.transferManager?.abort();
    this.transferManager = null;
    transferStore.resetTransferState();
    this.disposePeerConnection();

    this.peerDisconnectHandled = false;
    this.activeTargetPeerId = targetPeerId;
    this.channelsStarted = false;
    this.ctrl = null;
    this.files = null;

    const rtc = new FastRTC({
      id: deviceStore.identity.peerId,
      signal: (to, payload) => {
        this.deps.signaling.send({ type: "signal", targetPeerId: to, payload });
      },
    });
    this.rtc = rtc;
    rtc.channel(CTRL_LABEL, { ordered: true });
    rtc.channel(FILES_LABEL, { ordered: true });

    const events = new AbortController();
    rtc.addEventListener(
      "leave",
      ({ id }) => {
        if (id !== targetPeerId) return;
        this.cleanupPeerConnection();
      },
      { signal: events.signal },
    );
    rtc.addEventListener(
      "error",
      ({ id }) => {
        if (id !== targetPeerId) return;
        this.cleanupPeerConnection();
      },
      { signal: events.signal },
    );
    this.stopRtcEvents = () => events.abort();
  }

  private onPeerReady(peer: Peer) {
    void peer.ready.then(
      () => {
        if (!this.rtc) return;
        if (this.channelsStarted) return;
        if (peer.id !== this.activeTargetPeerId) return;
        this.ctrl = peer.channels.get(CTRL_LABEL) ?? null;
        this.files = peer.channels.get(FILES_LABEL) ?? null;
        this.watchChannelClose();
        this.tryStartTransfers(peer.id);
      },
      () => undefined,
    );
  }

  private watchChannelClose() {
    this.stopChannelClose?.();
    this.stopChannelClose = null;
    const { ctrl, files } = this;
    if (!ctrl || !files) return;
    const events = new AbortController();
    const onClose = () => this.cleanupPeerConnection();
    ctrl.addEventListener("close", onClose, { signal: events.signal });
    files.addEventListener("close", onClose, { signal: events.signal });
    this.stopChannelClose = () => events.abort();
  }

  private tryStartTransfers(targetPeerId: string) {
    if (this.channelsStarted) return;
    if (!this.ctrl || !this.files) return;
    if (this.ctrl.readyState !== "open" || this.files.readyState !== "open") return;
    this.channelsStarted = true;

    peerStore.connectedPeerId = targetPeerId;
    peerStore.connectingPeerId = null;
    peerStore.connectedViaLan = this.pendingLan;
    this.peerDisconnectHandled = false;
    logger.log(`(Share) peer connect lan=${this.pendingLan}`);

    if (uiStore.codeJoinOpen) {
      this.deps.codeJoin.onPeerConnected();
    } else {
      toastStore.showToast("Conectado", "success");
    }
    this.deps.signaling.suspend();

    void this.startTransfers(targetPeerId);
  }

  private async startTransfers(targetPeerId: string) {
    const ctrl = this.ctrl;
    const files = this.files;
    if (!ctrl || !files) return;

    if (this.lastConnectedPeerId && this.lastConnectedPeerId !== targetPeerId) {
      await downloadService.dropIncomplete();
    }
    if (this.ctrl !== ctrl || this.files !== files) return;
    this.lastConnectedPeerId = targetPeerId;

    this.transferManager = transferService.startTransferManager(
      ctrl,
      files,
      () => this.cleanupPeerConnection(),
      (fileId) => void fileLockManager.unlock(fileId),
      (fileId) => void fileLockManager.unlock(fileId),
    );
  }

  private cleanupPeerConnection() {
    if (this.peerDisconnectHandled) return;
    this.peerDisconnectHandled = true;

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
    this.pendingLan = false;

    this.disposePeerConnection({ markHandled: true });

    if (joinConnecting) {
      this.deps.codeJoin.fail("Falha na conexão");
      return;
    }

    this.deps.codeJoin.onPeerDisconnectCleanup();
    toastStore.showToast("Desconectado", "info");
    this.deps.signaling.resume(RESUME_AFTER_DISCONNECT_MS);
  }
}

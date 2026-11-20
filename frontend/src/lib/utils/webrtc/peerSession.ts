import { FastRTC, type Peer, type SignalPayload } from "fastrtc";
import { inject } from "quick-di";

import { PAIRING_TIMEOUT_MS } from "#lib/consts.js";
import { DownloadService } from "#lib/services/downloadService.js";
import { TransferService } from "#lib/services/transferService.js";
import { deviceStore } from "#lib/stores/deviceStore.svelte.js";
import { peerStore } from "#lib/stores/peerStore.svelte.js";
import { toastStore } from "#lib/stores/toast.svelte.js";
import { transferStore } from "#lib/stores/transferStore.svelte.js";
import { uiStore } from "#lib/stores/uiStore.svelte.js";
import type { Engine } from "#lib/transfer/engine.js";
import { logger } from "#lib/utils/logger.js";
import type { SignalingClient } from "#lib/utils/signaling/client.js";
import type { CodeJoinController } from "#lib/utils/webrtc/codeJoin.js";
import { CTRL_LABEL, FILES_LABEL, PeerLink } from "#lib/utils/webrtc/link.js";

const RESUME_AFTER_DISCONNECT_MS = 2_000;

export type PeerSessionDeps = {
  signaling: SignalingClient;
  codeJoin: CodeJoinController;
};

export class PeerSessionCoordinator {
  private readonly downloadService = inject(DownloadService);
  private readonly transferService = inject(TransferService);
  private rtc: FastRTC | null = null;
  private link: PeerLink | null = null;
  private engine: Engine | null = null;
  private activeTargetPeerId: string | null = null;
  private peerDisconnectHandled = false;
  private pendingLan = false;
  private lastConnectedPeerId: string | null = null;
  private stopRtcEvents: (() => void) | null = null;
  private pairingTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: PeerSessionDeps) {}

  getEngine() {
    return this.engine;
  }

  hasPeerConnection() {
    return this.rtc !== null;
  }

  setManualDownload(manual: boolean) {
    this.engine?.setManual(manual);
  }

  /** Starts a new pairing; a re-pair with the same peer replaces its old connection. */
  connectPeer(targetPeerId: string, lan = false) {
    this.setupRtc(targetPeerId, true);
    this.pendingLan = lan;
    peerStore.connectedPeerId = null;
    peerStore.connectingPeerId = targetPeerId;
    this.armPairingTimeout();
    this.openLink(this.rtc!.connect(targetPeerId));
  }

  handleSignal(fromPeerId: string, payload: SignalPayload) {
    if (this.activeTargetPeerId && this.activeTargetPeerId !== fromPeerId) return;
    this.setupRtc(fromPeerId);
    this.openLink(this.rtc!.receive(fromPeerId, payload));
  }

  disconnectPeer() {
    this.downloadService.abortAll();
    this.engine?.bye();
    this.cleanupPeerConnection();
  }

  /**
   * Stops the engine, resets the peer and transfer state, and closes the connection, without
   * the disconnect toast or a signaling resume (a failed or cancelled code join).
   */
  dropPeer() {
    transferStore.resetTransferState();
    this.transferService.clearPendingBatchCompletions();
    this.abort();

    peerStore.connectedPeerId = null;
    peerStore.connectedPeerInfo = null;
    peerStore.connectingPeerId = null;
    peerStore.connectedViaLan = false;
    this.pendingLan = false;

    this.disposePeerConnection({ markHandled: true });
  }

  handlePageUnload() {
    this.abort();
    this.disposePeerConnection();
  }

  abort() {
    this.engine?.close();
    this.engine = null;
  }

  disposePeerConnection(options?: { markHandled?: boolean }) {
    this.peerDisconnectHandled = true;
    this.clearPairingTimeout();
    const { rtc, link } = this;
    this.rtc = null;
    this.link = null;
    this.activeTargetPeerId = null;
    link?.close();
    this.stopRtcEvents?.();
    this.stopRtcEvents = null;
    rtc?.dispose();
    this.peerDisconnectHandled = options?.markHandled ?? false;
  }

  private setupRtc(targetPeerId: string, fresh = false) {
    if (!fresh && this.rtc && this.activeTargetPeerId === targetPeerId) return;

    this.abort();
    transferStore.resetTransferState();
    this.disposePeerConnection();

    this.peerDisconnectHandled = false;
    this.activeTargetPeerId = targetPeerId;

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
    const onLoss = ({ id }: { id: string }) => {
      if (id === targetPeerId) this.cleanupPeerConnection();
    };
    rtc.addEventListener("leave", onLoss, { signal: events.signal });
    rtc.addEventListener("error", onLoss, { signal: events.signal });
    this.stopRtcEvents = () => events.abort();
  }

  /** Builds the link once per peer; `rtc.receive` hands back the same peer for every signal. */
  private openLink(peer: Peer) {
    if (this.link) return;
    const link = new PeerLink();
    this.link = link;
    link.closed.addEventListener("abort", () => {
      if (this.link === link) this.cleanupPeerConnection();
    });
    link.open(peer).then(
      () => this.onLinkOpen(peer.id, link),
      () => undefined,
    );
  }

  private async onLinkOpen(targetPeerId: string, link: PeerLink) {
    if (this.link !== link) return;

    this.clearPairingTimeout();
    peerStore.connectedPeerId = targetPeerId;
    peerStore.connectingPeerId = null;
    peerStore.connectedViaLan = this.pendingLan;
    this.peerDisconnectHandled = false;
    logger.log(`(Share) peer connect lan=${this.pendingLan} chunk=${link.chunkSize}`);

    if (uiStore.codeJoinOpen) {
      this.deps.codeJoin.onPeerConnected();
    } else {
      toastStore.showToast("Conectado", "success");
    }
    this.deps.signaling.stop();

    if (this.lastConnectedPeerId && this.lastConnectedPeerId !== targetPeerId) {
      await this.downloadService.dropIncomplete();
    }
    if (this.link !== link) return;
    this.lastConnectedPeerId = targetPeerId;
    this.engine = this.transferService.start(link, () => this.cleanupPeerConnection());
  }

  private cleanupPeerConnection() {
    if (this.peerDisconnectHandled) return;
    this.peerDisconnectHandled = true;

    logger.log("(Share) peer disconnect");

    const joinConnecting = uiStore.codeJoinOpen && peerStore.codeJoinPhase === "connecting";
    this.dropPeer();

    if (joinConnecting) {
      this.deps.codeJoin.fail("Falha na conexão");
      return;
    }

    this.deps.codeJoin.onPeerDisconnectCleanup();
    toastStore.showToast("Desconectado", "info");
    this.deps.signaling.resume(RESUME_AFTER_DISCONNECT_MS);
  }

  /** A pairing that never opens frees the session for the next peer. */
  private armPairingTimeout() {
    this.clearPairingTimeout();
    this.pairingTimeout = setTimeout(() => {
      this.pairingTimeout = null;
      this.cleanupPeerConnection();
    }, PAIRING_TIMEOUT_MS);
  }

  private clearPairingTimeout() {
    if (!this.pairingTimeout) return;
    clearTimeout(this.pairingTimeout);
    this.pairingTimeout = null;
  }
}

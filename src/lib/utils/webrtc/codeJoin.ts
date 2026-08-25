import { peerStore } from "#lib/stores/peerStore.svelte.js";
import { uiStore } from "#lib/stores/uiStore.svelte.js";
import { logger } from "#lib/utils/logger.js";
import type { SignalingClient } from "#lib/utils/signaling/client.js";
import type { PeerSessionCoordinator } from "#lib/utils/webrtc/peerSession.js";

const PAIRING_TIMEOUT_MS = 15_000;
const JOIN_TRIES = 3;
const JOIN_RETRY_MS = 1_500;
const CODE_JOIN_CONNECTED_CLOSE_MS = 3_000;
const CODE_JOIN_CLOSE_MS = 300;

export class CodeJoinController {
  private code: string | null = null;
  private rejections = 0;
  private joinWait: PromiseWithResolvers<string | null> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pairingTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectedTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly signaling: SignalingClient,
    private readonly peerSession: () => PeerSessionCoordinator,
    private readonly isSignalingReady: () => boolean,
    private readonly onJoinFailed: (message: string) => void,
  ) {}

  /** Resolves with `null` once the server pairs us, or with an error message. */
  join(code: string): Promise<string | null> {
    this.clearTimers();
    this.resolveJoin(null);

    this.code = code;
    this.rejections = 0;
    this.joinWait = Promise.withResolvers<string | null>();

    uiStore.codeJoinOpen = true;
    peerStore.codeJoinPhase = "waiting";
    this.signaling.resume();
    if (this.isSignalingReady()) this.sendJoinCode();

    return this.joinWait.promise;
  }

  /** Called once the local peer is announced, so the server can resolve the code. */
  onSignalingReady() {
    if (!this.code || this.retryTimer) return;
    this.sendJoinCode();
  }

  onJoinAccepted(hostId: string, lan: boolean) {
    if (!this.code) return;

    this.code = null;
    this.clearRetry();
    this.resolveJoin(null);

    peerStore.codeJoinPhase = "connecting";
    peerStore.connectingPeerId = hostId;
    this.peerSession().setIceLan(lan);
    void this.peerSession().beginAsOfferer(hostId);
    this.armPairingTimeout();
  }

  onJoinRejected() {
    if (!this.code) return;

    this.rejections += 1;
    logger.log(`(Share) join-rejected ${this.rejections}/${JOIN_TRIES}`);
    if (this.rejections >= JOIN_TRIES) {
      this.fail("Código inválido");
      return;
    }

    this.clearRetry();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.sendJoinCode();
    }, JOIN_RETRY_MS);
  }

  onPeerConnected() {
    this.clearRetry();
    this.clearPairingTimeout();
    if (uiStore.codeJoinOpen) this.finishSuccess();
  }

  onPeerDisconnectCleanup() {
    if (!uiStore.codeJoinOpen) return;
    this.clearTimers();
    this.closeOverlay();
  }

  finishSuccess() {
    if (!uiStore.codeJoinOpen || this.connectedTimeout) return;

    this.clearRetry();
    this.clearPairingTimeout();
    peerStore.codeJoinPhase = "connected";
    this.connectedTimeout = setTimeout(() => {
      this.connectedTimeout = null;
      this.closeOverlay();
    }, CODE_JOIN_CONNECTED_CLOSE_MS);
  }

  fail(message: string) {
    logger.log(`(Share) code join failed: ${message}`);
    this.code = null;
    this.clearTimers();

    if (this.peerSession().hasPeerConnection()) {
      this.peerSession().disposePeerConnection({ markHandled: true });
    }
    peerStore.connectingPeerId = null;
    peerStore.connectedPeerInfo = null;

    this.signaling.suspend();
    this.closeOverlay();

    if (this.joinWait) {
      this.resolveJoin(message);
      return;
    }
    this.onJoinFailed(message);
  }

  cancel() {
    if (!uiStore.codeJoinOpen) return;
    this.fail("Conexão cancelada");
  }

  destroy() {
    this.code = null;
    this.clearTimers();
    this.resolveJoin(null);
    uiStore.codeJoinOpen = false;
    peerStore.codeJoinPhase = "waiting";
  }

  private sendJoinCode() {
    if (!this.code) return;
    logger.log(`(Share) join-code → ${this.code}`);
    this.signaling.send({ type: "join-code", code: this.code });
  }

  private resolveJoin(result: string | null) {
    this.joinWait?.resolve(result);
    this.joinWait = null;
  }

  private armPairingTimeout() {
    this.clearPairingTimeout();
    this.pairingTimeout = setTimeout(() => {
      this.pairingTimeout = null;
      if (peerStore.connectedPeerId) return;
      this.fail("Falha na conexão");
    }, PAIRING_TIMEOUT_MS);
  }

  private clearPairingTimeout() {
    if (!this.pairingTimeout) return;
    clearTimeout(this.pairingTimeout);
    this.pairingTimeout = null;
  }

  private clearRetry() {
    if (!this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearConnectedTimeout() {
    if (!this.connectedTimeout) return;
    clearTimeout(this.connectedTimeout);
    this.connectedTimeout = null;
  }

  private clearTimers() {
    this.clearRetry();
    this.clearPairingTimeout();
    this.clearConnectedTimeout();
  }

  private closeOverlay() {
    if (!uiStore.codeJoinOpen) {
      peerStore.codeJoinPhase = "waiting";
      return;
    }

    uiStore.codeJoinOpen = false;
    setTimeout(() => {
      peerStore.codeJoinPhase = "waiting";
    }, CODE_JOIN_CLOSE_MS);
  }
}

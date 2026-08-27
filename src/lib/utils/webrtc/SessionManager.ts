import { queueService } from "#lib/runtime.js";
import { deviceStore } from "#lib/stores/deviceStore.svelte.js";
import { logger } from "#lib/utils/logger.js";
import { fetchPublicIpv4 } from "#lib/utils/net/publicIp.js";
import { SignalingClient } from "#lib/utils/signaling/client.js";
import { CodeJoinController } from "#lib/utils/webrtc/codeJoin.js";
import { PeerSessionCoordinator } from "#lib/utils/webrtc/peerSession.js";
import { createSignalingHandlers } from "#lib/utils/webrtc/signalingHandlers.js";

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

export type SessionCodeAccessors = {
  getCode: () => string | undefined;
  getIsHost: () => boolean;
  onCodeAssigned: (code: string) => void;
  onJoinFailed: (message: string) => void;
};

export class SessionManager {
  readonly peerSession: PeerSessionCoordinator;
  readonly codeJoin: CodeJoinController;

  private readonly signaling = new SignalingClient();
  private publicIpv4: string | undefined;
  private publicIpv4Fetched = false;
  private announced = false;
  private readonly getCode: () => string | undefined;
  private readonly getIsHost: () => boolean;
  private readonly onCodeAssigned: (code: string) => void;

  constructor(accessors: SessionCodeAccessors) {
    this.getCode = accessors.getCode;
    this.getIsHost = accessors.getIsHost;
    this.onCodeAssigned = accessors.onCodeAssigned;

    this.codeJoin = new CodeJoinController(
      this.signaling,
      () => this.peerSession,
      () => this.announced,
      accessors.onJoinFailed,
    );
    this.peerSession = new PeerSessionCoordinator({
      signaling: this.signaling,
      codeJoin: this.codeJoin,
    });
    queueService.bind(() => this.peerSession.getTransferManager());
  }

  announce() {
    if (!this.signaling.isConnected()) return;
    const host = this.getIsHost();
    const code = host ? this.getCode() : undefined;
    logger.log(`(Share) announce host=${host} code=${code ?? ""}`);
    this.signaling.send({
      type: "announce",
      peerId: deviceStore.identity.peerId,
      displayName: deviceStore.displayName,
      deviceHint: deviceStore.identity.deviceHint,
      host,
      code,
      publicIpv4: this.publicIpv4,
    });
    this.announced = true;
    this.codeJoin.onSignalingReady();
  }

  async joinSignaling() {
    logger.log("(Share) joinSignaling");
    if (!this.publicIpv4Fetched) {
      this.publicIpv4 = await fetchPublicIpv4();
      this.publicIpv4Fetched = true;
    }
    this.announce();
  }

  wakeSignaling(reason: "online" | "visibility") {
    this.signaling.wakeReconnect(reason);
  }

  connect() {
    this.signaling.connect(
      createSignalingHandlers({
        peerSession: this.peerSession,
        codeJoin: this.codeJoin,
        joinSignaling: () => this.joinSignaling(),
        onCodeAssigned: (code) => this.onCodeAssigned(code),
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
    this.codeJoin.destroy();
    queueService.reset();
  }
}

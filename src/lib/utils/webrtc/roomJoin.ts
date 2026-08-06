import { appState } from "$lib/stores/appState.svelte";
import { toastStore } from "$lib/stores/toast.svelte";
import { logger } from "$lib/utils/logger";

const ROOM_JOIN_TIMEOUT_MS = 15_000;
const ROOM_JOIN_CONNECTED_CLOSE_MS = 3_000;
const ROOM_JOIN_CLOSE_MS = 300;

export type RoomJoinSignaling = {
  send: (message: { type: "connect-request"; targetPeerId: string; roomCode?: string }) => void;
  suspend: () => void;
  resume: () => void | Promise<void>;
};

export type RoomJoinPeerActions = {
  disposePeerConnection: (options?: { markHandled?: boolean }) => void;
  hasPeerConnection: () => boolean;
};

export class RoomJoinController {
  private roomJoinTimeout: ReturnType<typeof setTimeout> | null = null;
  private roomJoinConnectedTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly signaling: RoomJoinSignaling,
    private readonly peer: RoomJoinPeerActions,
  ) {}

  generateRoomCode(): string {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    return String(bytes[0]! % 1_000_000).padStart(6, "0");
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

  finishRoomJoinSuccess() {
    if (!appState.roomJoinOpen || this.roomJoinConnectedTimeout) return;

    this.clearRoomJoinTimeout();
    appState.roomJoinPhase = "connected";
    this.roomJoinConnectedTimeout = setTimeout(() => {
      this.roomJoinConnectedTimeout = null;
      this.clearRoomJoinState();
    }, ROOM_JOIN_CONNECTED_CLOSE_MS);
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

      if (this.peer.hasPeerConnection()) {
        this.peer.disposePeerConnection({ markHandled: true });
        void this.signaling.resume();
      }
    }

    this.clearRoomJoinState();
  }

  onPeerListUpdated() {
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
  }

  onPeerConnected() {
    this.clearRoomJoinTimeout();
    if (appState.roomJoinOpen) {
      this.finishRoomJoinSuccess();
    }
  }

  onPeerDisconnectWhileConnecting() {
    this.unlockRoomJoin("Falha na conexão", "error");
    void this.signaling.resume();
  }

  onConnectResponseRejected(targetPeerId: string) {
    if (appState.connectingPeerId !== targetPeerId) return;

    if (appState.roomJoinOpen) {
      if (appState.roomJoinMode === "auto") {
        this.unlockRoomJoin("Código incorreto", "error");
      } else {
        this.unlockRoomJoin("Conexão recusada", "warning");
      }
      return true;
    }

    toastStore.showToast("Conexão recusada", "warning");
    appState.connectingPeerId = null;
    appState.connectedPeerInfo = null;
    return true;
  }

  onPeerDisconnectCleanup() {
    if (appState.roomJoinOpen) {
      this.clearRoomJoinState();
    }
  }

  failRoomJoinTimeout() {
    if (this.peer.hasPeerConnection()) {
      this.peer.disposePeerConnection({ markHandled: true });
    }

    appState.connectingPeerId = null;
    appState.connectedPeerInfo = null;
    this.clearRoomJoinTimers();
    this.signaling.suspend();
    appState.roomJoinPhase = "failed";
  }

  clearTimers() {
    this.clearRoomJoinTimers();
  }

  destroy() {
    this.clearRoomJoinTimers();
    appState.roomJoinOpen = false;
    appState.roomJoinPhase = "waiting";
    appState.roomJoinMode = null;
    appState.roomJoinCode = null;
    appState.roomJoinTargetPeerId = null;
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

  private startRoomJoinTimeout() {
    this.clearRoomJoinTimeout();
    this.roomJoinTimeout = setTimeout(() => {
      this.roomJoinTimeout = null;
      if (!appState.roomJoinOpen || appState.connectedPeerId) return;
      this.failRoomJoinTimeout();
    }, ROOM_JOIN_TIMEOUT_MS);
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
}

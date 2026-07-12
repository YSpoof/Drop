import type { ClientMessage, ServerMessage } from "./types";

export type SignalingHandlers = {
  onPeerList?: (message: Extract<ServerMessage, { type: "peer-list" }>) => void;
  onConnectRequest?: (message: Extract<ServerMessage, { type: "connect-request" }>) => void;
  onConnectResponse?: (message: Extract<ServerMessage, { type: "connect-response" }>) => void;
  onSdpOffer?: (message: Extract<ServerMessage, { type: "sdp-offer" }>) => void;
  onSdpAnswer?: (message: Extract<ServerMessage, { type: "sdp-answer" }>) => void;
  onIceCandidate?: (message: Extract<ServerMessage, { type: "ice-candidate" }>) => void;
  onClose?: (intentional: boolean) => void;
  onOpen?: () => void;
};

const MAX_RECONNECT_DELAY_MS = 30_000;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private handlers: SignalingHandlers = {};
  private intentionalClose = false;
  private suspended = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(handlers: SignalingHandlers) {
    this.handlers = handlers;
    this.openSocket();
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private scheduleReconnect() {
    if (this.suspended || this.ws || this.reconnectTimer) return;

    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS);
    this.reconnectAttempt += 1;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.suspended && !this.ws) {
        this.openSocket();
      }
    }, delay);
  }

  private openSocket() {
    this.clearReconnectTimer();
    this.intentionalClose = false;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${protocol}://${location.host}/ws`);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.handlers.onOpen?.();
    };
    this.ws.onclose = () => {
      const intentional = this.intentionalClose;
      this.ws = null;
      if (!intentional && !this.suspended) {
        this.scheduleReconnect();
      }
      this.handlers.onClose?.(intentional);
    };
    this.ws.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }

      switch (message.type) {
        case "peer-list":
          this.handlers.onPeerList?.(message);
          break;
        case "connect-request":
          this.handlers.onConnectRequest?.(message);
          break;
        case "connect-response":
          this.handlers.onConnectResponse?.(message);
          break;
        case "sdp-offer":
          this.handlers.onSdpOffer?.(message);
          break;
        case "sdp-answer":
          this.handlers.onSdpAnswer?.(message);
          break;
        case "ice-candidate":
          this.handlers.onIceCandidate?.(message);
          break;
      }
    };
  }

  send(message: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  announce(payload: Extract<ClientMessage, { type: "announce" }>) {
    this.send(payload);
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  suspend() {
    this.suspended = true;
    this.clearReconnectTimer();
    if (!this.ws) return;
    this.intentionalClose = true;
    this.ws.close();
    this.ws = null;
  }

  resume() {
    this.suspended = false;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    if (this.ws) return;
    this.openSocket();
  }

  disconnect() {
    this.suspended = true;
    this.clearReconnectTimer();
    if (!this.ws) return;
    this.intentionalClose = true;
    this.ws.close();
    this.ws = null;
  }
}

import { logger } from "#lib/utils/logger.js";

import type { ClientMessage, ServerMessage } from "./types";

export type SignalingHandlers = {
  onCodeAssigned?: (message: Extract<ServerMessage, { type: "code-assigned" }>) => void;
  onPeerJoining?: (message: Extract<ServerMessage, { type: "peer-joining" }>) => void;
  onJoinAccepted?: (message: Extract<ServerMessage, { type: "join-accepted" }>) => void;
  onJoinRejected?: () => void;
  onSdpOffer?: (message: Extract<ServerMessage, { type: "sdp-offer" }>) => void;
  onSdpAnswer?: (message: Extract<ServerMessage, { type: "sdp-answer" }>) => void;
  onIceCandidate?: (message: Extract<ServerMessage, { type: "ice-candidate" }>) => void;
  onClose?: (intentional: boolean) => void;
  onOpen?: () => void;
};

const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TIMEOUT_MS = 8_000;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private handlers: SignalingHandlers = {};
  private intentionalClose = false;
  private suspended = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;

  connect(handlers: SignalingHandlers) {
    this.handlers = handlers;
    this.openSocket();
  }

  /** Call from Svelte window/document listeners when network or tab wakes. */
  wakeReconnect(reason: "online" | "visibility") {
    if (this.suspended || this.ws) return;
    logger.log(`(WS) wake reconnect (${reason})`);
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.openSocket();
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearHeartbeatTimeout() {
    if (!this.heartbeatTimeout) return;
    clearTimeout(this.heartbeatTimeout);
    this.heartbeatTimeout = null;
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearHeartbeatTimeout();
  }

  private startHeartbeat() {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      this.clearHeartbeatTimeout();
      this.send({ type: "ping" });
      this.heartbeatTimeout = setTimeout(() => {
        logger.log("(WS) heartbeat miss");
        this.heartbeatTimeout = null;
        if (!this.ws) return;
        this.ws.close();
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private scheduleReconnect() {
    if (this.suspended || this.ws || this.reconnectTimer) return;

    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt += 1;
    logger.log(`(WS) reconnect delay=${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.suspended && !this.ws) {
        this.openSocket();
      }
    }, delay);
  }

  private openSocket() {
    this.clearReconnectTimer();
    this.clearHeartbeat();
    this.intentionalClose = false;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${protocol}://${location.host}/ws`);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      logger.log("(WS) open");
      this.startHeartbeat();
      this.handlers.onOpen?.();
    };
    this.ws.onclose = () => {
      const intentional = this.intentionalClose;
      this.ws = null;
      this.clearHeartbeat();
      logger.log(`(WS) close intentional=${intentional}`);
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
        case "pong":
          this.clearHeartbeatTimeout();
          break;
        case "code-assigned":
          this.handlers.onCodeAssigned?.(message);
          break;
        case "peer-joining":
          this.handlers.onPeerJoining?.(message);
          break;
        case "join-accepted":
          this.handlers.onJoinAccepted?.(message);
          break;
        case "join-rejected":
          this.handlers.onJoinRejected?.();
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

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  suspend() {
    this.close("suspend");
  }

  disconnect() {
    this.close("disconnect");
  }

  resume(delayMs = 0) {
    this.suspended = false;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    logger.log(`(WS) resume delay=${delayMs}ms`);
    if (this.ws) return;

    if (delayMs > 0) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.suspended && !this.ws) this.openSocket();
      }, delayMs);
      return;
    }

    this.openSocket();
  }

  private close(reason: "suspend" | "disconnect") {
    this.suspended = true;
    this.clearReconnectTimer();
    this.clearHeartbeat();
    logger.log(`(WS) ${reason}`);
    if (!this.ws) return;
    this.intentionalClose = true;
    this.ws.close();
    this.ws = null;
  }
}

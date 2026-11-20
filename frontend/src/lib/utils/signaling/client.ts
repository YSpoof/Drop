import { logger } from "#lib/utils/logger.js";

import type { ClientMessage, ServerMessage } from "./types";

export type SignalingHandlers = {
  onCodeAssigned?: (message: Extract<ServerMessage, { type: "code-assigned" }>) => void;
  onPeerJoining?: (message: Extract<ServerMessage, { type: "peer-joining" }>) => void;
  onJoinAccepted?: (message: Extract<ServerMessage, { type: "join-accepted" }>) => void;
  onJoinRejected?: () => void;
  onSignal?: (message: Extract<ServerMessage, { type: "signal" }>) => void;
  /** Fires only when the connection is lost; `stop()` never fires it, so `intentional` is always false. */
  onClose?: () => void;
  onOpen?: () => void;
};

const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
/** A pong older than this at a heartbeat tick means the last ping went unanswered. */
const HEARTBEAT_TIMEOUT_MS = 15_000;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private handlers: SignalingHandlers = {};
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPong = 0;

  connect(handlers: SignalingHandlers) {
    this.handlers = handlers;
    this.openSocket();
  }

  /** Call from Svelte window/document listeners when network or tab wakes. */
  wakeReconnect(reason: "online" | "visibility") {
    if (this.stopped || this.ws) return;
    logger.log(`(WS) wake reconnect (${reason})`);
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  send(message: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Close the socket without reconnecting or firing `onClose`, until `resume()`. */
  stop() {
    this.stopped = true;
    this.clearReconnectTimer();
    logger.log("(WS) stop");
    this.dropSocket();
  }

  resume(delayMs = 0) {
    this.stopped = false;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    logger.log(`(WS) resume delay=${delayMs}ms`);
    if (this.ws) return;
    if (delayMs > 0) {
      this.openAfter(delayMs);
      return;
    }
    this.openSocket();
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearHeartbeat() {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private startHeartbeat() {
    this.lastPong = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastPong > HEARTBEAT_TIMEOUT_MS) {
        logger.log("(WS) heartbeat miss");
        this.lost();
        return;
      }
      this.send({ type: "ping" });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private openAfter(delayMs: number) {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delayMs);
  }

  /** Detach and close the current socket, so its late events can never touch this client. */
  private dropSocket() {
    this.clearHeartbeat();
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    ws.onopen = null;
    ws.onclose = null;
    ws.onmessage = null;
    ws.close();
  }

  /** The connection died on its own (server close, network loss, heartbeat miss). */
  private lost() {
    this.dropSocket();
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt += 1;
    logger.log(`(WS) lost, reconnect delay=${delay}ms`);
    this.openAfter(delay);
    this.handlers.onClose?.();
  }

  private openSocket() {
    this.clearReconnectTimer();
    this.dropSocket();
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      logger.log("(WS) open");
      this.startHeartbeat();
      this.handlers.onOpen?.();
    };
    ws.onclose = () => this.lost();
    ws.onmessage = (event) => this.handleMessage(event);
  }

  private handleMessage(event: MessageEvent) {
    let message: ServerMessage;
    try {
      message = JSON.parse(String(event.data)) as ServerMessage;
    } catch {
      return;
    }

    switch (message.type) {
      case "pong":
        this.lastPong = Date.now();
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
      case "signal":
        this.handlers.onSignal?.(message);
        break;
    }
  }
}

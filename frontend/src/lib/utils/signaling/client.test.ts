import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignalingClient } from "./client";

vi.mock("#lib/utils/logger.js", () => ({ logger: { log: () => undefined } }));

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static sockets: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: unknown[] = [];
  closeCalls = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.sockets.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.closeCalls += 1;
  }

  /** Server side: complete the handshake. */
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** Browser side: the close event arrives (possibly late, after `close()`). */
  fireClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const sockets = () => FakeWebSocket.sockets;
const last = () => sockets().at(-1)!;

describe("SignalingClient", () => {
  let client: SignalingClient;
  const onClose = vi.fn();
  const onOpen = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("location", { protocol: "http:", host: "drop.test" });
    FakeWebSocket.sockets = [];
    onClose.mockReset();
    onOpen.mockReset();
    client = new SignalingClient();
    client.connect({ onClose, onOpen });
    last().open();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connects to the page host", () => {
    expect(last().url).toBe("ws://drop.test/ws");
    expect(client.isConnected()).toBe(true);
  });

  it("stop() then resume() ignores the stale socket's late close", () => {
    const stale = last();
    client.stop();
    expect(stale.closeCalls).toBe(1);

    client.resume();
    const fresh = last();
    expect(fresh).not.toBe(stale);
    fresh.open();

    stale.fireClose();
    vi.advanceTimersByTime(5_000); // past the max reconnect delay, before a heartbeat tick

    expect(onClose).not.toHaveBeenCalled();
    expect(sockets()).toHaveLength(2);
    expect(client.isConnected()).toBe(true);
    client.send({ type: "join-code", code: "1234" });
    expect(fresh.sent).toContainEqual({ type: "join-code", code: "1234" });
  });

  it("stop() keeps the client down until resume()", () => {
    client.stop();
    client.wakeReconnect("online");
    vi.advanceTimersByTime(60_000);
    expect(sockets()).toHaveLength(1);
    expect(client.isConnected()).toBe(false);
  });

  it("resume(delay) opens one socket after the delay", () => {
    client.stop();
    client.resume(1_000);
    vi.advanceTimersByTime(999);
    expect(sockets()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets()).toHaveLength(2);
  });

  it("an unexpected close reports once and reconnects once", () => {
    last().fireClose();
    expect(onClose).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(500);
    expect(sockets()).toHaveLength(2);
    vi.advanceTimersByTime(60_000);
    expect(sockets()).toHaveLength(2);
  });

  it("answered pings keep the socket alive", () => {
    const ws = last();
    for (let i = 0; i < 5; i += 1) {
      vi.advanceTimersByTime(10_000);
      ws.receive({ type: "pong" });
    }
    expect(ws.sent.filter((m) => (m as { type: string }).type === "ping")).toHaveLength(5);
    expect(ws.closeCalls).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a heartbeat timeout closes the dead socket once and reconnects", () => {
    const dead = last();
    vi.advanceTimersByTime(20_000);
    expect(dead.closeCalls).toBe(1);
    expect(onClose).toHaveBeenCalledOnce();

    dead.fireClose();
    vi.advanceTimersByTime(500);
    expect(sockets()).toHaveLength(2);
    last().open();

    vi.advanceTimersByTime(5_000);
    expect(dead.closeCalls).toBe(1);
    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});

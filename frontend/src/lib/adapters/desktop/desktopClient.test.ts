import { afterEach, beforeEach, expect, test, vi } from "vitest";

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: Array<{ id: string; method: string }> = [];
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  reply(id: string, result: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ id, result }) }));
  }
}

async function loadClient() {
  vi.resetModules();
  return import("#lib/adapters/desktop/desktopClient.js");
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  const storage = new Map<string, string>();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("window", {
    location: { href: "http://localhost/?dropPort=4000&dropToken=secret" },
    history: { replaceState: () => undefined },
  });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function connect() {
  const client = await loadClient();
  const started = client.startDesktop(2000);
  const socket = FakeWebSocket.instances[0];
  socket.open();
  await started;
  return { client, socket };
}

test("connect timeout closes the pending socket and ignores a late open", async () => {
  const client = await loadClient();
  const started = client.startDesktop(2000);
  const rejection = expect(started).rejects.toThrow("Timeout connecting");
  const socket = FakeWebSocket.instances[0];

  await vi.advanceTimersByTimeAsync(2000);
  await rejection;
  expect(socket.readyState).toBe(FakeWebSocket.CLOSED);

  socket.open();
  expect(() => client.getDesktopSession()).toThrow("not initialized");
  await expect(client.callRpc("fs.stat")).rejects.toThrow("not open");
});

test("a failed connect leaves the session unset", async () => {
  const client = await loadClient();
  const started = client.startDesktop(2000);
  FakeWebSocket.instances[0].onerror?.(new Event("error"));

  await expect(started).rejects.toThrow("connection failed");
  expect(() => client.getDesktopSession()).toThrow("not initialized");
});

test("a successful connect sets the session", async () => {
  const { client } = await connect();
  expect(client.getDesktopSession()).toEqual({ port: 4000, token: "secret" });
});

test("callRpc rejects after the default timeout and ignores a late reply", async () => {
  const { client, socket } = await connect();
  const call = client.callRpc("fs.stat", { path: "/x" });
  const rejection = expect(call).rejects.toThrow("RPC fs.stat timed out");

  await vi.advanceTimersByTimeAsync(client.RPC_TIMEOUT_MS - 1);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  await rejection;

  socket.reply(socket.sent[0].id, { exists: true });
  expect(vi.getTimerCount()).toBe(0);
});

test("a reply in time resolves and clears the timer", async () => {
  const { client, socket } = await connect();
  const call = client.callRpc("fs.stat", { path: "/x" });
  socket.reply(socket.sent[0].id, { exists: true });

  await expect(call).resolves.toEqual({ exists: true });
  expect(vi.getTimerCount()).toBe(0);
});

test("dialog calls wait for the user without a timeout", async () => {
  const { client, socket } = await connect();
  const call = client.callRpc<string>("dialog.pickFolder");
  expect(vi.getTimerCount()).toBe(0);

  await vi.advanceTimersByTimeAsync(10 * 60_000);
  socket.reply(socket.sent[0].id, "/picked");
  await expect(call).resolves.toBe("/picked");
});

test("closing the bridge rejects pending calls", async () => {
  const { client, socket } = await connect();
  const call = client.callRpc("fs.stat");
  socket.onclose?.(new Event("close"));

  await expect(call).rejects.toThrow("Bridge socket closed");
  await expect(client.callRpc("fs.stat")).rejects.toThrow("not open");
});

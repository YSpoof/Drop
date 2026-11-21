export type DesktopSession = {
  port: number;
  token: string;
};

type RpcResponse = {
  id: string;
  result?: unknown;
  error?: string;
};

type BridgeNotification = {
  event: string;
  data: unknown;
};

let session: DesktopSession | null = null;
let bridgeSocket: WebSocket | null = null;

const pendingCalls = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
>();

const notificationListeners = new Map<string, Set<(data: unknown) => void>>();

export function getDesktopSession(): DesktopSession {
  if (!session) {
    throw new Error("Desktop host session is not initialized");
  }
  return session;
}

function resolveCredentials(): DesktopSession | null {
  if (typeof window === "undefined") return null;

  const url = new URL(window.location.href);
  const portParam = url.searchParams.get("dropPort");
  const tokenParam = url.searchParams.get("dropToken");

  if (portParam && tokenParam) {
    const port = Number.parseInt(portParam, 10);
    if (!Number.isNaN(port) && port > 0) {
      sessionStorage.setItem("dropPort", String(port));
      sessionStorage.setItem("dropToken", tokenParam);

      // Scrub credentials from URL immediately
      url.searchParams.delete("dropPort");
      url.searchParams.delete("dropToken");
      window.history.replaceState(null, "", url.toString());

      return { port, token: tokenParam };
    }
  }

  const storedPort = sessionStorage.getItem("dropPort");
  const storedToken = sessionStorage.getItem("dropToken");
  if (storedPort && storedToken) {
    const port = Number.parseInt(storedPort, 10);
    if (!Number.isNaN(port) && port > 0) {
      return { port, token: storedToken };
    }
  }

  return null;
}

export function onBridgeNotification(event: string, callback: (data: unknown) => void): () => void {
  let listeners = notificationListeners.get(event);
  if (!listeners) {
    listeners = new Set();
    notificationListeners.set(event, listeners);
  }
  listeners.add(callback);

  return () => {
    listeners?.delete(callback);
    if (listeners?.size === 0) {
      notificationListeners.delete(event);
    }
  };
}

/** Default RPC timeout. Host liveness is covered by the socket close; this guards a lost reply. */
export const RPC_TIMEOUT_MS = 30_000;

/** Dialogs wait on the user and `fs.move` may copy a large file across devices: no timeout. */
function rpcTimeout(method: string): number {
  return method.startsWith("dialog.") || method === "fs.move" ? 0 : RPC_TIMEOUT_MS;
}

function rejectPending(error: Error) {
  for (const pending of pendingCalls.values()) pending.reject(error);
  pendingCalls.clear();
}

/** Calls a bridge method; `timeoutMs` 0 waits until the reply or the socket closes. */
export function callRpc<T = unknown>(
  method: string,
  params?: unknown,
  timeoutMs = rpcTimeout(method),
): Promise<T> {
  if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Bridge WebSocket is not open"));
  }

  const id = crypto.randomUUID();
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          pendingCalls.delete(id);
          reject(new Error(`RPC ${method} timed out after ${timeoutMs} ms`));
        }, timeoutMs)
      : undefined;
  pendingCalls.set(id, {
    resolve: (value) => {
      clearTimeout(timer);
      resolve(value as T);
    },
    reject: (reason) => {
      clearTimeout(timer);
      reject(reason);
    },
  });

  bridgeSocket.send(JSON.stringify({ id, method, params }));
  return promise;
}

function onBridgeMessage(event: MessageEvent) {
  let raw: (RpcResponse & Partial<BridgeNotification>) | null = null;
  try {
    raw = JSON.parse(event.data);
  } catch {
    return; // Ignore unparseable frames
  }
  if (!raw) return;

  if (raw.event) {
    for (const listener of notificationListeners.get(raw.event) ?? []) listener(raw.data);
    return;
  }

  const pending = pendingCalls.get(raw.id);
  if (!pending) return;
  pendingCalls.delete(raw.id);
  if (raw.error) pending.reject(new Error(raw.error));
  else pending.resolve(raw.result);
}

export function startDesktop(timeoutMs = 2000): Promise<void> {
  const credentials = resolveCredentials();
  if (!credentials) {
    return Promise.reject(new Error("No desktop host credentials found in URL or session"));
  }

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const ws = new WebSocket(
    `ws://127.0.0.1:${credentials.port}/bridge?token=${encodeURIComponent(credentials.token)}`,
  );

  const fail = (error: Error) => {
    clearTimeout(timer);
    ws.onopen = ws.onerror = ws.onclose = ws.onmessage = null;
    ws.close();
    reject(error);
  };
  const timer = setTimeout(
    () => fail(new Error("Timeout connecting to desktop host bridge")),
    timeoutMs,
  );

  ws.onerror = ws.onclose = () => fail(new Error("Desktop host bridge connection failed"));
  ws.onopen = () => {
    clearTimeout(timer);
    ws.onerror = null;
    ws.onclose = () => {
      if (bridgeSocket !== ws) return;
      bridgeSocket = null;
      rejectPending(new Error("Bridge socket closed"));
    };
    ws.onmessage = onBridgeMessage;
    bridgeSocket = ws;
    session = credentials;
    resolve();
  };

  return promise;
}

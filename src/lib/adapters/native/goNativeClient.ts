export type NativeSession = {
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

let session: NativeSession | null = null;
let bridgeSocket: WebSocket | null = null;

const pendingCalls = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
>();

const notificationListeners = new Map<string, Set<(data: unknown) => void>>();

export function getNativeSession(): NativeSession {
  if (!session) {
    throw new Error("Go native host session is not initialized");
  }
  return session;
}

function resolveCredentials(): NativeSession | null {
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

export function callRpc<T = unknown>(method: string, params?: unknown): Promise<T> {
  if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("Bridge WebSocket is not open"));
  }

  const id = crypto.randomUUID();
  const promise = new Promise<T>((resolve, reject) => {
    pendingCalls.set(id, {
      resolve: (res) => resolve(res as T),
      reject,
    });
  });

  const payload = JSON.stringify({ id, method, params });
  bridgeSocket.send(payload);

  return promise;
}

export async function startGoNative(timeoutMs = 2000): Promise<void> {
  const credentials = resolveCredentials();
  if (!credentials) {
    throw new Error("No native host credentials found in URL or session");
  }

  session = credentials;

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      bridgeSocket?.close();
      bridgeSocket = null;
      reject(new Error("Timeout connecting to native host bridge"));
    }, timeoutMs);

    const wsUrl = `ws://127.0.0.1:${credentials.port}/bridge?token=${encodeURIComponent(credentials.token)}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      clearTimeout(timer);
      bridgeSocket = ws;
      resolve();
    };

    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(err);
    };

    ws.onclose = () => {
      bridgeSocket = null;
      for (const [id, pending] of pendingCalls.entries()) {
        pending.reject(new Error("Bridge socket closed"));
        pendingCalls.delete(id);
      }
    };

    ws.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);
        if ("event" in raw) {
          const notif = raw as BridgeNotification;
          const listeners = notificationListeners.get(notif.event);
          if (listeners) {
            for (const listener of listeners) {
              listener(notif.data);
            }
          }
          return;
        }

        const resp = raw as RpcResponse;
        if (resp.id && pendingCalls.has(resp.id)) {
          const pending = pendingCalls.get(resp.id)!;
          pendingCalls.delete(resp.id);
          if (resp.error) {
            pending.reject(new Error(resp.error));
          } else {
            pending.resolve(resp.result);
          }
        }
      } catch {
        // Ignore unparseable frames
      }
    };
  });
}

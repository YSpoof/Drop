/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

declare let self: ServiceWorkerGlobalScope;

import { build, files, prerendered, version } from "$service-worker";

import { pushSharedRecord } from "./lib/utils/files/webShare";

const CACHE_NAME = `drop-${version}`;
const ASSETS = [...build, ...files, ...prerendered];
const DOWNLOAD_PREFIX = "/__download__/";

type PendingDownload = {
  stream: ReadableStream;
  headers: HeadersInit;
};

const pendingDownloads = new Map<string, PendingDownload>();

function encodeContentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_");

  const encoded = encodeURIComponent(filename)
    .replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function streamFromPort(port: MessagePort): ReadableStream<Uint8Array> {
  const pending: Uint8Array[] = [];
  let isClosed = false;
  let isErrored = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

  const pump = () => {
    if (!streamController || isErrored) return;

    while (pending.length > 0) {
      try {
        streamController.enqueue(pending.shift()!);
      } catch {
        return;
      }
    }

    if (isClosed) {
      try {
        streamController.close();
      } catch {
        // already closed
      }
    }
  };

  port.onmessage = (event) => {
    const data = event.data;
    if (data === "ping") return;

    if (data === "end") {
      isClosed = true;
      pump();
      return;
    }

    if (data === "abort") {
      isErrored = true;
      try {
        streamController?.error(new Error("Download aborted"));
      } catch {
        // already errored/closed
      }
      return;
    }

    if (data instanceof ArrayBuffer) {
      pending.push(new Uint8Array(data));
      pump();
      return;
    }
    if (data instanceof Uint8Array) {
      pending.push(data);
      pump();
      return;
    }
    if (ArrayBuffer.isView(data)) {
      pending.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      pump();
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
    pull() {
      pump();
    },
    cancel() {
      isErrored = true;
      try {
        port.postMessage("abort");
      } catch {
        // port closed
      }
    },
  });
}

function handleDownloadMessage(event: ExtendableMessageEvent) {
  const data = event.data as
    | {
        type?: string;
        filename?: string;
        size?: number;
        mime?: string;
        readableStream?: ReadableStream;
      }
    | string
    | undefined;

  if (data === "ping" || (typeof data === "object" && data?.type === "ping")) {
    event.ports[0]?.postMessage("pong");
    return;
  }

  if (typeof data === "object" && data?.type === "claim") {
    void self.clients.claim();
    return;
  }

  if (typeof data === "object" && data?.type === "abort-downloads") {
    for (const [pathname, pending] of pendingDownloads) {
      void pending.stream.cancel();
      pendingDownloads.delete(pathname);
    }
    return;
  }

  if (typeof data !== "object" || data?.type !== "download") return;

  const port = event.ports[0];
  if (!port) return;

  const id = crypto.randomUUID();
  const pathname = `${DOWNLOAD_PREFIX}${id}`;
  const downloadUrl = new URL(pathname, self.registration.scope).href;
  const filename = data.filename || "download";

  const stream =
    data.readableStream instanceof ReadableStream ? data.readableStream : streamFromPort(port);

  const headers: Record<string, string> = {
    "Content-Type": data.mime || "application/octet-stream",
    "Content-Disposition": encodeContentDisposition(filename),
  };
  if (typeof data.size === "number" && Number.isFinite(data.size) && data.size >= 0) {
    headers["Content-Length"] = String(data.size);
  }

  pendingDownloads.set(pathname, { stream, headers });
  port.postMessage({ download: downloadUrl });
}

async function handleWebShareEvent(event: FetchEvent): Promise<Response> {
  const form = await event.request.formData();
  const files = form.getAll("files") as File[];

  try {
    const recordId = crypto.randomUUID?.() ?? String(Date.now());
    const storedFiles = files.map((file) => ({
      name: file.name,
      type: file.type,
      blob: file,
    }));

    await pushSharedRecord({
      id: recordId,
      timestamp: Date.now(),
      files: storedFiles,
    });
  } catch (err) {
    console.error("Failed to store shared files", err);
  }

  return Response.redirect("/", 303);
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  handleDownloadMessage(event);
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname.startsWith(DOWNLOAD_PREFIX)) {
    // Intercept download requests from the browser
    // This allows us to pipe the MessagePort stream directly into a real file download
    // without loading the entire file in memory.
    const pending = pendingDownloads.get(url.pathname);
    if (pending) {
      pendingDownloads.delete(url.pathname);
      event.respondWith(new Response(pending.stream, { headers: pending.headers }));
      return;
    }
  }

  if (request.method === "POST" && url.pathname === "/web-share-catcher") {
    event.respondWith(handleWebShareEvent(event));
    return;
  }

  if (request.method !== "GET") return;

  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      try {
        return await fetch(request);
      } catch {
        if (request.mode === "navigate") {
          const fallback = await caches.match("/");
          if (fallback) return fallback;
        }
        return Response.error();
      }
    })(),
  );
});

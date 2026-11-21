import { version } from "$app/env";
import { assets, immutable, prerendered } from "$app/manifest";
import { self } from "$app/service-worker";

import { pushSharedRecord } from "../lib/utils/files/webShare";

const CACHE_NAME = `drop-${version}`;
const staticAssets = assets.filter((asset) => !asset.path.startsWith("downloads/"));
const ASSETS = [...immutable, ...staticAssets, ...prerendered].map((asset) => `/${asset.path}`);
const DOWNLOAD_PREFIX = "/__download__/";

type PendingDownload = {
  stream: ReadableStream<Uint8Array>;
  headers: HeadersInit;
};

type DownloadRequest = { type: "download"; filename?: string; size?: number; mime?: string };

/** Downloads waiting for the browser's fetch, by path. */
const pendingDownloads = new Map<string, PendingDownload>();

function encodeContentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_");

  const encoded = encodeURIComponent(filename)
    .replace(/['()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\*/g, "%2A");

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * The page's chunks as a pull stream: a chunk leaves the queue only when the browser reads it,
 * and its `ack` lets the page send more. The page stops at 4 MiB unacknowledged, so the queue
 * stays bounded while a Save-as prompt is open or the disk is slow.
 */
function streamFromPort(port: MessagePort, onDone: () => void): ReadableStream<Uint8Array> {
  const queue: Uint8Array[] = [];
  let ended = false;
  let failed = false;
  let wake: (() => void) | null = null;
  let stream!: ReadableStreamDefaultController<Uint8Array>;

  const fail = () => {
    failed = true;
    queue.length = 0;
    onDone();
  };

  port.onmessage = ({ data }) => {
    if (data === "end") {
      ended = true;
    } else if (data === "abort") {
      fail();
      stream.error(new Error("Download aborted"));
    } else if (data instanceof ArrayBuffer) {
      queue.push(new Uint8Array(data));
    }
    wake?.();
  };

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        stream = controller;
      },
      async pull(controller) {
        while (queue.length === 0 && !ended && !failed) {
          const next = Promise.withResolvers<void>();
          wake = next.resolve;
          await next.promise;
          wake = null;
        }
        if (failed) return;
        const chunk = queue.shift();
        if (chunk) {
          controller.enqueue(chunk);
          port.postMessage({ ack: chunk.byteLength });
          return;
        }
        controller.close();
        port.postMessage("end-ack");
        port.close();
      },
      cancel() {
        fail();
        wake?.();
        port.postMessage("abort");
        port.close();
      },
    },
    // Pull only when the browser reads, so nothing piles up inside the stream itself.
    { highWaterMark: 0 },
  );
}

function openDownload(data: DownloadRequest, port: MessagePort | undefined) {
  if (!port) return;

  const pathname = `${DOWNLOAD_PREFIX}${crypto.randomUUID()}`;
  const headers: Record<string, string> = {
    "Content-Type": data.mime || "application/octet-stream",
    "Content-Disposition": encodeContentDisposition(data.filename || "download"),
  };
  if (typeof data.size === "number" && Number.isFinite(data.size) && data.size >= 0) {
    headers["Content-Length"] = String(data.size);
  }

  const stream = streamFromPort(port, () => pendingDownloads.delete(pathname));
  pendingDownloads.set(pathname, { stream, headers });
  port.postMessage({ download: new URL(pathname, self.registration.scope).href });
}

async function kill() {
  console.warn("(SW): ☠ - killing");
  const keys = await caches.keys();
  await Promise.allSettled(keys.map((key) => caches.delete(key)));
  await self.registration.unregister();
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

// `keepalive` needs no branch: receiving any message keeps the worker running.
self.addEventListener("message", (event) => {
  const data = event.data as { type?: string } | null | undefined;
  switch (data?.type) {
    case "download":
      openDownload(data as DownloadRequest, event.ports[0]);
      break;
    case "claim":
      event.waitUntil(self.clients.claim());
      break;
    case "KILL":
      event.waitUntil(kill());
      break;
  }
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

  if (request.method === "POST" && url.pathname.includes("/web-share-catcher/")) {
    event.respondWith(handleWebShareEvent(event));
    return;
  }

  if (request.method !== "GET") return;

  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { cacheName: CACHE_NAME });
      if (cached) return cached;

      try {
        return await fetch(request);
      } catch {
        if (request.mode === "navigate") {
          const fallback = await caches.match("/", { cacheName: CACHE_NAME });
          if (fallback) return fallback;
        }
        return Response.error();
      }
    })(),
  );
});

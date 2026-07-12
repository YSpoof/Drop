import { DownloadError, type CreateDownloadStreamOptions } from "./transferTypes";

const DOWNLOAD_MESSAGE_TYPE = "download";

type ActiveDownloadHandle = {
  abort: () => void;
};

const activeDownloads = new Set<ActiveDownloadHandle>();

export function abortAllDownloadStreams(): void {
  for (const handle of activeDownloads) {
    handle.abort();
  }
  activeDownloads.clear();

  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.controller?.postMessage({ type: "abort-downloads" });
  }
}

async function waitForServiceWorkerController(timeoutMs = 8_000): Promise<ServiceWorker> {
  if (!("serviceWorker" in navigator)) {
    throw new DownloadError("Service worker unavailable");
  }

  const registration = await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) {
    return navigator.serviceWorker.controller;
  }

  if (registration.active) {
    registration.active.postMessage({ type: "claim" });
  }

  const { promise, resolve, reject } = Promise.withResolvers<ServiceWorker>();

  const timer = setTimeout(() => {
    cleanup();
    reject(new DownloadError("Service worker not controlling this page"));
  }, timeoutMs);

  const onChange = () => {
    if (navigator.serviceWorker.controller) {
      cleanup();
      resolve(navigator.serviceWorker.controller);
    }
  };

  const cleanup = () => {
    clearTimeout(timer);
    navigator.serviceWorker.removeEventListener("controllerchange", onChange);
  };

  navigator.serviceWorker.addEventListener("controllerchange", onChange);
  if (navigator.serviceWorker.controller) {
    cleanup();
    resolve(navigator.serviceWorker.controller);
  }

  return await promise;
}

function triggerBrowserDownload(url: string) {
  const iframe = document.createElement("iframe");
  iframe.hidden = true;
  iframe.src = url;
  document.body.appendChild(iframe);
  setTimeout(() => iframe.remove(), 60_000);
}

/**
 * Sets up a streaming download using the Service Worker.
 * We pass a MessagePort to the SW, through which we will push the binary chunks.
 * The SW intercepts a special /__download__/ URL and pipes our MessagePort chunks
 * to the browser's download manager, allowing downloads of any size.
 */
export async function createDownloadWritableStream(
  filename: string,
  opts: CreateDownloadStreamOptions = {},
): Promise<WritableStream<Uint8Array>> {
  if (typeof window === "undefined") {
    throw new DownloadError("Download stream only available in the browser");
  }

  const controller = await waitForServiceWorkerController();
  const channel = new MessageChannel();

  const { promise, resolve, reject } = Promise.withResolvers<WritableStream<Uint8Array>>();
  let settled = false;
  let aborted = false;
  let downloadUrl: string | null = null;
  let downloadTriggered = false;
  let ping: ReturnType<typeof setInterval> | null = null;

  const clearPing = () => {
    if (ping) {
      clearInterval(ping);
      ping = null;
    }
  };

  const ensureDownloadStarted = () => {
    if (downloadTriggered || !downloadUrl || aborted) return;
    downloadTriggered = true;
    triggerBrowserDownload(downloadUrl);

    ping = setInterval(() => {
      try {
        channel.port1.postMessage("ping");
      } catch {
        clearPing();
      }
    }, 5_000);
  };

  const handleBrowserAbort = () => {
    if (aborted) return;
    aborted = true;
    clearPing();
    opts.onAbort?.();
  };

  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    reject(new DownloadError("Timed out opening download stream"));
  }, 10_000);

  channel.port1.onmessage = (event) => {
    const data = event.data as { download?: string; error?: string } | string;

    if (data === "abort") {
      handleBrowserAbort();
      return;
    }

    if (typeof data === "string") return;

    if (data.error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new DownloadError(data.error));
      return;
    }

    if (!data.download) return;
    if (settled) return;
    settled = true;
    clearTimeout(timeout);

    downloadUrl = data.download;

    const handle: ActiveDownloadHandle = {
      abort: () => {
        if (aborted) return;
        aborted = true;
        clearPing();
        try {
          channel.port1.postMessage("abort");
        } catch {
          // port closed
        }
      },
    };
    activeDownloads.add(handle);

    const unregister = () => {
      activeDownloads.delete(handle);
    };

    resolve(
      new WritableStream<Uint8Array>({
        write(chunk) {
          if (aborted) {
            return Promise.reject(new DownloadError("Download cancelled"));
          }
          // Defer browser fetch until first byte so zip (slow first chunk) does not
          // open an empty SW stream that the browser cancels immediately.
          ensureDownloadStarted();
          channel.port1.postMessage(chunk);
        },
        close() {
          unregister();
          clearPing();
          if (!aborted) {
            ensureDownloadStarted();
            channel.port1.postMessage("end");
          }
        },
        abort(reason) {
          unregister();
          if (aborted) return;
          aborted = true;
          clearPing();
          channel.port1.postMessage("abort");
          void reason;
        },
      }),
    );
  };

  controller.postMessage(
    {
      type: DOWNLOAD_MESSAGE_TYPE,
      filename,
      size: opts.size,
      mime: opts.mime ?? "application/octet-stream",
    },
    [channel.port2],
  );

  return await promise;
}

export async function createDirectDownloadWriter(
  filename: string,
  opts: CreateDownloadStreamOptions = {},
): Promise<WritableStreamDefaultWriter<Uint8Array>> {
  const stream = await createDownloadWritableStream(filename, opts);
  return stream.getWriter();
}

export async function downloadFile(source: Blob | File, filename: string): Promise<void> {
  if (typeof window === "undefined") return;
  const writable = await createDownloadWritableStream(filename, {
    size: source.size,
    mime: source.type || "application/octet-stream",
  });
  await source.stream().pipeTo(writable);
}

export async function ensureServiceWorkerReady(timeoutMs = 8_000): Promise<boolean> {
  try {
    await waitForServiceWorkerController(timeoutMs);
    return true;
  } catch {
    return false;
  }
}

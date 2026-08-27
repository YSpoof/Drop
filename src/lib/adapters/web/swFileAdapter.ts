import type { FileAdapterPort } from "#lib/ports/fileAdapter.js";
import {
  DownloadError,
  type CreateDownloadStreamOptions,
  type DownloadHandle,
} from "#lib/utils/files/transferTypes.js";

const DOWNLOAD_MESSAGE_TYPE = "download";

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

export class SwFileAdapter implements FileAdapterPort {
  #active = new Set<DownloadHandle>();

  abortAll(): void {
    for (const handle of this.#active) {
      handle.abort();
    }
    this.#active.clear();

    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.controller?.postMessage({ type: "abort-downloads" });
    }
  }

  async ensureReady(timeoutMs = 8_000): Promise<boolean> {
    try {
      await waitForServiceWorkerController(timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Streaming download via Service Worker MessagePort.
   * SW intercepts /__download__/ and pipes chunks to the browser download manager.
   */
  async createWritableStream(
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

      const handle: DownloadHandle = {
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
      this.#active.add(handle);

      const unregister = () => {
        this.#active.delete(handle);
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
}

import { FileAdapterPort } from "#lib/ports/fileAdapter.js";
import { FileTooLargeError } from "#lib/transfer/errors.js";
import { DownloadError, type CreateDownloadStreamOptions } from "#lib/utils/files/transferTypes.js";

/*
 * Page <-> service worker wire (private to this file and `src/service-worker/index.ts`):
 * - page -> controller: `{ type: "download", filename, size, mime }` with a MessagePort,
 *   `{ type: "keepalive" }` while a download is open, `{ type: "claim" }`.
 * - page -> port: `ArrayBuffer` chunks (transferred), `"end"`, `"abort"`.
 * - port -> page: `{ download: url }` or `{ error }` once, `{ ack: bytes }` per chunk the
 *   browser took, `"end-ack"` after the last one, `"abort"` when the browser cancelled.
 */

/** How long `ensureReady` waits for a controlling service worker before using the fallback. */
const READY_TIMEOUT_MS = 4_000;
/** Largest file (or zip) the in-memory fallback accepts; larger ones are refused. */
export const BLOB_FALLBACK_LIMIT = 512 * 1024 * 1024;
/** Bytes posted to the worker but not yet taken by the browser before `write()` waits. */
export const QUEUE_LIMIT = 4 * 1024 * 1024;
const REPLY_TIMEOUT_MS = 10_000;
const END_ACK_TIMEOUT_MS = 5_000;
const KEEPALIVE_MS = 10_000;
const URL_LIFETIME_MS = 60_000;

type Reply = { download: string } | { error: string } | { ack: number } | "end-ack" | "abort";

const cancelled = () => new DownloadError("Download cancelled");

/** The controlling worker, or null when none takes control within `timeoutMs`. */
async function controllerWithin(timeoutMs: number): Promise<ServiceWorker | null> {
  if (!("serviceWorker" in navigator)) return null;
  const sw = navigator.serviceWorker;
  if (sw.controller) return sw.controller;

  const { promise, resolve } = Promise.withResolvers<ServiceWorker | null>();
  const onChange = () => {
    if (sw.controller) resolve(sw.controller);
  };
  const timer = setTimeout(() => resolve(null), timeoutMs);
  sw.addEventListener("controllerchange", onChange);
  sw.ready.then(
    (registration) => {
      onChange();
      registration.active?.postMessage({ type: "claim" });
    },
    () => resolve(null),
  );
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
    sw.removeEventListener("controllerchange", onChange);
  }
}

function hiddenFrame(url: string) {
  const iframe = document.createElement("iframe");
  iframe.hidden = true;
  iframe.src = url;
  document.body.appendChild(iframe);
  setTimeout(() => iframe.remove(), URL_LIFETIME_MS);
}

/**
 * Streams into a browser download through the service worker. `write()` stays pending while
 * more than `QUEUE_LIMIT` bytes wait in the worker, so the engine's window bounds memory.
 */
async function workerDownload(
  controller: ServiceWorker,
  filename: string,
  opts: CreateDownloadStreamOptions,
  active: Set<() => void>,
): Promise<WritableStream<Uint8Array>> {
  const { port1: port, port2 } = new MessageChannel();
  const opened = Promise.withResolvers<string>();
  opened.promise.catch(() => undefined);
  let url = "";
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let queued = 0;
  let room: PromiseWithResolvers<void> | null = null;
  let ended: PromiseWithResolvers<void> | null = null;

  const finish = () => {
    active.delete(abort);
    clearInterval(keepalive);
  };
  const stop = (tellWorker: boolean) => {
    if (stopped) return;
    stopped = true;
    finish();
    if (tellWorker) port.postMessage("abort");
    opened.reject(cancelled());
    room?.resolve();
    ended?.resolve();
  };
  const abort = () => stop(true);
  active.add(abort);

  // The browser fetches on the first byte, so a slow first chunk (zip) does not open an empty
  // download that the browser cancels right away.
  const start = () => {
    if (keepalive !== undefined || stopped) return;
    hiddenFrame(url);
    // Port messages do not keep the worker alive; controller messages do.
    keepalive = setInterval(() => controller.postMessage({ type: "keepalive" }), KEEPALIVE_MS);
  };

  port.onmessage = ({ data }: MessageEvent<Reply>) => {
    if (data === "end-ack") {
      finish();
      ended?.resolve();
    } else if (data === "abort") {
      if (stopped) return;
      stop(false);
      opts.onAbort?.();
    } else if ("ack" in data) {
      queued -= data.ack;
      if (queued <= QUEUE_LIMIT) room?.resolve();
    } else if ("error" in data) {
      opened.reject(new DownloadError(data.error));
    } else {
      opened.resolve(data.download);
    }
  };

  const timer = setTimeout(
    () => opened.reject(new DownloadError("Timed out opening download stream")),
    REPLY_TIMEOUT_MS,
  );
  controller.postMessage(
    { type: "download", filename, size: opts.size, mime: opts.mime ?? "application/octet-stream" },
    [port2],
  );
  try {
    url = await opened.promise;
  } catch (error) {
    stop(true);
    throw error;
  } finally {
    clearTimeout(timer);
  }

  return new WritableStream<Uint8Array>({
    start(sink) {
      // Fires at `writer.abort()` even while a write waits for room.
      sink.signal.addEventListener("abort", abort);
    },
    async write(chunk) {
      if (stopped) throw cancelled();
      start();
      // The caller may still read its view (the engine reads `byteLength`), so transfer a copy.
      const buffer = chunk.slice().buffer;
      queued += buffer.byteLength;
      port.postMessage(buffer, [buffer]);
      while (queued > QUEUE_LIMIT && !stopped) {
        room = Promise.withResolvers();
        await room.promise;
        room = null;
      }
      if (stopped) throw cancelled();
    },
    async close() {
      if (stopped) return;
      start();
      active.delete(abort);
      ended = Promise.withResolvers();
      const wait = setTimeout(ended.resolve, END_ACK_TIMEOUT_MS);
      port.postMessage("end");
      await ended.promise;
      clearTimeout(wait);
    },
    abort,
  });
}

/**
 * Fallback without a service worker: each chunk moves into browser blob storage at once, and
 * the whole file is saved as one Blob on close. The browser holds the full file until then,
 * so files (and zips, which have no size up front) above `BLOB_FALLBACK_LIMIT` are refused.
 */
function blobDownload(
  filename: string,
  opts: CreateDownloadStreamOptions,
  active: Set<() => void>,
): WritableStream<Uint8Array> {
  if ((opts.size ?? 0) > BLOB_FALLBACK_LIMIT) throw new FileTooLargeError(BLOB_FALLBACK_LIMIT);
  let parts: Blob[] = [];
  let held = 0;
  let stopped = false;
  const abort = () => {
    stopped = true;
    parts = [];
    active.delete(abort);
  };
  active.add(abort);

  return new WritableStream<Uint8Array>({
    write(chunk) {
      if (stopped) throw cancelled();
      held += chunk.byteLength;
      if (held > BLOB_FALLBACK_LIMIT) {
        abort();
        throw new FileTooLargeError(BLOB_FALLBACK_LIMIT);
      }
      parts.push(new Blob([chunk as Uint8Array<ArrayBuffer>]));
    },
    close() {
      if (stopped) return;
      active.delete(abort);
      const blob = new Blob(parts, { type: opts.mime ?? "application/octet-stream" });
      parts = [];
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), URL_LIFETIME_MS);
    },
    abort,
  });
}

export class SwFileAdapter extends FileAdapterPort {
  /** Aborts of this page's open downloads; other tabs keep theirs. */
  #active = new Set<() => void>();
  #ready: Promise<ServiceWorker | null> | null = null;

  abortAll(): void {
    for (const abort of [...this.#active]) abort();
  }

  /** Waits briefly for the worker; without one, downloads use the in-memory fallback. */
  async ensureReady(timeoutMs = READY_TIMEOUT_MS): Promise<void> {
    await this.#controller(timeoutMs);
  }

  async createWritableStream(
    filename: string,
    opts: CreateDownloadStreamOptions = {},
  ): Promise<WritableStream<Uint8Array>> {
    if (typeof window === "undefined") {
      throw new DownloadError("Download stream only available in the browser");
    }
    const controller = await this.#controller(READY_TIMEOUT_MS);
    if (!controller) return blobDownload(filename, opts, this.#active);
    return workerDownload(controller, filename, opts, this.#active);
  }

  /** The live controller, else the first wait's result (a failed wait is not repeated). */
  async #controller(timeoutMs: number): Promise<ServiceWorker | null> {
    const live = "serviceWorker" in navigator ? navigator.serviceWorker.controller : null;
    if (live) return live;
    this.#ready ??= controllerWithin(timeoutMs);
    return (await this.#ready) ?? navigator.serviceWorker?.controller ?? null;
  }
}

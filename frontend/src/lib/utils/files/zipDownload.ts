import { inject } from "quick-di";

import { DownloadService } from "#lib/services/downloadService.js";

import { DownloadError } from "./transferTypes";

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }

  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let index = 1;

  while (used.has(`${base} (${index})${ext}`)) index += 1;
  const unique = `${base} (${index})${ext}`;
  used.add(unique);
  return unique;
}

interface QueuedEntry {
  name: string;
  size: number;
  input: ReadableStream<Uint8Array>;
}

type AddEntry = () => Promise<WritableStreamDefaultWriter<Uint8Array>>;

/** Abort/cancel outcomes that callers already handle; anything else rejects `finalize()`. */
function isBenign(error: unknown) {
  if (error === undefined) return true; // writer.abort() without a reason
  return error instanceof DownloadError && error.message === "Download cancelled";
}

const ignore = () => undefined;

/**
 * One file inside the zip. It joins the archive on its first write (or on `close` when it
 * is empty), so an entry aborted before any byte leaves no trace. Aborting after bytes were
 * written ends the entry where it stopped: the archive keeps that truncated file, with its
 * real CRC and size, and stays valid for every other entry.
 */
export class ZipEntry {
  private writer: Promise<WritableStreamDefaultWriter<Uint8Array>> | null = null;
  private ended = false;

  constructor(private readonly add: AddEntry) {}

  async write(bytes: Uint8Array) {
    if (this.ended) throw new Error("Zip entry closed");
    this.writer ??= this.add();
    await (await this.writer).write(bytes);
  }

  async close() {
    if (this.ended) throw new Error("Zip entry closed");
    this.ended = true;
    this.writer ??= this.add();
    await (await this.writer).close();
  }

  /** Never errors the zip: an unwritten entry is skipped, a started one is ended. */
  async abort() {
    if (this.ended) return;
    this.ended = true;
    const writer = await this.writer?.catch(ignore);
    await writer?.close().catch(ignore);
  }
}

export class ZipDownloadSession {
  private readonly downloads = inject(DownloadService);
  private queue: QueuedEntry[] = [];
  private entryControls: TransformStreamDefaultController<Uint8Array>[] = [];
  private usedNames = new Set<string>();
  private wake: (() => void) | null = null;
  private closed = false;
  private finalized = false;
  private starting: Promise<void> | null = null;
  private streamDone = Promise.resolve();
  private readonly filename: string;

  constructor(
    filename = `drop-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.zip`,
    private readonly opts: { onAbort?: () => void } = {},
  ) {
    this.filename = filename;
  }

  private async start() {
    if (typeof window === "undefined") return;

    const fileStream = await this.downloads.createWritableStream(this.filename, {
      mime: "application/zip",
      onAbort: this.opts.onAbort,
    });
    const { downloadZip } = await import("client-zip");
    const body = downloadZip(this.entries()).body;
    if (!body) throw new Error("Zip response has no body");

    this.streamDone = body.pipeTo(fileStream).catch((error: unknown) => {
      this.fail(error);
      if (!isBenign(error)) throw error;
    });
    // `finalize()` reports the failure; until then it is not an unhandled rejection.
    this.streamDone.catch(ignore);
  }

  /** The zip stream died: error every entry so no writer waits forever. */
  private fail(error: unknown) {
    this.closed = true;
    this.wake?.();
    this.wake = null;
    for (const control of this.entryControls) control.error(error);
  }

  /** A new entry. Its writes resolve only as the zip stream consumes them (backpressure). */
  async openEntry(name: string, size: number): Promise<ZipEntry> {
    if (this.finalized) throw new Error("Zip download already finalized");
    return new ZipEntry(() => this.add(name, size));
  }

  /** Queues an entry into the zip; the download itself starts with the first entry. */
  private async add(name: string, size: number): Promise<WritableStreamDefaultWriter<Uint8Array>> {
    if (this.closed) throw new Error("Zip download closed");
    // A failed start resets, so the next entry retries instead of queueing into nothing.
    this.starting ??= this.start().catch((error: unknown) => {
      this.starting = null;
      throw error;
    });
    await this.starting;
    if (this.closed) throw new Error("Zip download closed");

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
      start: (control) => {
        this.entryControls.push(control);
      },
    });
    this.queue.push({ name: uniqueName(name, this.usedNames), size, input: readable });
    this.wake?.();
    this.wake = null;
    return writable.getWriter();
  }

  async finalize() {
    if (this.finalized) return;
    this.finalized = true;
    this.closed = true;
    this.wake?.();
    this.wake = null;
    await this.streamDone;
  }

  private async *entries() {
    while (!this.closed || this.queue.length > 0) {
      const entry = this.queue.shift();
      if (entry) {
        yield { name: entry.name, input: entry.input, size: entry.size, lastModified: new Date() };
        continue;
      }

      if (!this.closed) {
        const { promise, resolve } = Promise.withResolvers<void>();
        this.wake = resolve;
        await promise;
      }
    }
  }
}

import type { DownloadService } from "#lib/services/downloadService.js";

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

export class ZipDownloadSession {
  private queue: QueuedEntry[] = [];
  private usedNames = new Set<string>();
  private wake: (() => void) | null = null;
  private closed = false;
  private started = false;
  private finalized = false;
  private streamDone = Promise.resolve();
  private readonly filename: string;

  constructor(
    private readonly downloads: DownloadService,
    filename = `drop-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.zip`,
    private readonly opts: { onAbort?: () => void } = {},
  ) {
    this.filename = filename;
  }

  isFinalized() {
    return this.finalized;
  }

  private async start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;

    const fileStream = await this.downloads.createWritableStream(this.filename, {
      mime: "application/zip",
      onAbort: this.opts.onAbort,
    });
    const { downloadZip } = await import("client-zip");
    const response = downloadZip(this.entries());

    this.streamDone = (async () => {
      if (!response.body) {
        throw new Error("Zip response has no body");
      }
      await response.body.pipeTo(fileStream);
    })().catch((error) => {
      // Browser/SW abort and entry teardown surface here; callers that care await finalize().
      if (error instanceof Error && error.message === "Zip entry aborted") return;
      if (error instanceof DownloadError && error.message === "Download cancelled") return;
      throw error;
    });
  }

  async openEntry(name: string, size: number): Promise<WritableStreamDefaultWriter<Uint8Array>> {
    if (this.finalized) {
      throw new Error("Zip download already finalized");
    }
    if (!this.started) await this.start();

    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });

    const entryName = uniqueName(name, this.usedNames);
    this.queue.push({ name: entryName, size, input });
    this.wake?.();
    this.wake = null;

    return new WritableStream<Uint8Array>({
      write(chunk) {
        streamController.enqueue(chunk);
      },
      close() {
        streamController.close();
      },
      abort(reason) {
        streamController.error(reason ?? new Error("Zip entry aborted"));
      },
    }).getWriter();
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

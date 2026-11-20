//! Test fixtures: an in-memory paired `Link`, a memory `Source` and `Sink`, recording `Hooks`.
//! Traffic crosses the link asynchronously and control messages go through JSON, as on a
//! real data channel.

import { decodeControl, encodeControl, fileIdentity, type ControlMessage } from "./protocol";
import type {
  Archive,
  BatchInfo,
  Direction,
  Finished,
  Hooks,
  Link,
  Offer,
  Outgoing,
  Row,
  Sink,
  Source,
  Writer,
} from "./types";

/** Whatever consumes a link's inbound traffic (an `Engine`, or a test script). */
export interface Endpoint {
  onControl(message: ControlMessage): void;
  onFrame(frame: Uint8Array): void;
}

export class TestLink implements Link {
  /** Everything this side sent, in order. */
  readonly controls: ControlMessage[] = [];
  readonly frames: Uint8Array[] = [];
  peer: Endpoint | null = null;
  /** Hold `sendFrame` until the test resolves it (backpressure). */
  gate: Promise<void> | null = null;
  private readonly stop = new AbortController();
  readonly closed = this.stop.signal;

  constructor(readonly chunkSize = 16) {}

  sendControl(message: ControlMessage) {
    if (this.closed.aborted) return;
    this.controls.push(message);
    const text = encodeControl(message);
    void Promise.resolve().then(() => {
      const decoded = decodeControl(text);
      if (decoded && !this.closed.aborted) this.peer?.onControl(decoded);
    });
  }

  async sendFrame(frame: Uint8Array) {
    if (this.gate) await this.gate;
    this.closed.throwIfAborted();
    const copy = frame.slice();
    this.frames.push(copy);
    void Promise.resolve().then(() => {
      if (!this.closed.aborted) this.peer?.onFrame(copy);
    });
  }

  close() {
    this.stop.abort(new Error("Link closed"));
  }

  /** Control messages of `type` this side sent. */
  sent<T extends ControlMessage["type"]>(type: T): Extract<ControlMessage, { type: T }>[] {
    return this.controls.filter((m) => m.type === type) as Extract<ControlMessage, { type: T }>[];
  }
}

/** Two links wired to each other; closing one closes both. */
export function pairLinks(chunkSize = 16): [TestLink, TestLink] {
  const a = new TestLink(chunkSize);
  const b = new TestLink(chunkSize);
  a.closed.addEventListener("abort", () => b.close());
  b.closed.addEventListener("abort", () => a.close());
  return [a, b];
}

/** Lets every queued microtask and one macrotask turn run, `rounds` times. */
export async function settle(rounds = 5) {
  for (let round = 0; round < rounds; round += 1) {
    const turn = Promise.withResolvers<void>();
    setImmediate(turn.resolve);
    await turn.promise;
  }
}

/** Deterministic, non-repeating-per-chunk test bytes. */
export function bytesOf(length: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = (index * 31 + seed) % 251;
  return bytes;
}

export class MemorySource implements Source {
  readonly items: Outgoing[] = [];
  readonly data = new Map<string, Uint8Array>();
  /** Replace to make a read fail or stall. */
  failRead: ((item: Outgoing, offset: number) => Promise<void> | void) | null = null;

  add(id: string, bytes: Uint8Array, name = `${id}.bin`): Outgoing {
    const item = { id, name, size: bytes.byteLength, mime: "application/octet-stream", hash: "" };
    item.hash = fileIdentity(name, bytes.byteLength, 1_700_000_000_000);
    this.items.push(item);
    this.data.set(id, bytes);
    return item;
  }

  list() {
    return this.items;
  }

  async read(item: Outgoing, offset: number, length: number) {
    await this.failRead?.(item, offset);
    const bytes = this.data.get(item.id);
    if (!bytes) throw new Error(`No such file: ${item.id}`);
    return bytes.slice(offset, offset + length);
  }
}

export type DownloadState = "open" | "closed" | "aborted" | "discarded";

/** One download or archive entry as the sink saw it. */
export class Download implements Writer {
  state: DownloadState = "open";
  private chunks: Uint8Array[] = [];

  constructor(
    readonly offer: Offer,
    readonly offset: number,
    prefix: Uint8Array,
    private readonly sink: MemorySink,
    readonly onAbort: () => void,
  ) {
    this.chunks.push(prefix);
  }

  get bytes(): Uint8Array {
    const out = new Uint8Array(this.chunks.reduce((sum, c) => sum + c.byteLength, 0));
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.byteLength;
    }
    return out;
  }

  async write(bytes: Uint8Array) {
    await this.sink.beforeWrite?.(this, bytes);
    if (this.state !== "open") throw new Error("Download closed");
    this.chunks.push(bytes.slice());
  }

  async close() {
    this.state = "closed";
  }

  async abort(discard: boolean) {
    if (this.state !== "open") return;
    this.state = discard ? "discarded" : "aborted";
    if (!discard && this.offer.hash) this.sink.partials.set(this.offer.hash, this.bytes);
  }
}

export class MemoryArchive implements Archive {
  readonly entries: Download[] = [];
  finalized = 0;

  constructor(
    readonly name: string | undefined,
    private readonly sink: MemorySink,
    readonly onAbort: () => void,
  ) {}

  async entry(offer: Offer) {
    await this.sink.beforeOpen?.(offer);
    const entry = new Download(offer, 0, new Uint8Array(), this.sink, () => undefined);
    this.entries.push(entry);
    return entry;
  }

  async finalize() {
    this.finalized += 1;
  }
}

export class MemorySink implements Sink {
  readonly downloads: Download[] = [];
  readonly archives: MemoryArchive[] = [];
  /** Retained partial files by `offer.hash`. */
  readonly partials = new Map<string, Uint8Array>();
  readonly dropped: string[] = [];
  /** Whether `archive()` zips (web) or returns `null` (desktop). */
  zips = true;
  /** Runs before each write is accepted; reject or stall here. */
  beforeWrite: ((download: Download, bytes: Uint8Array) => Promise<void> | void) | null = null;
  /** Runs before `open` and `archive.entry` resolve; reject or stall here. */
  beforeOpen: ((offer: Offer) => Promise<void> | void) | null = null;

  async resumeOffset(offer: Offer) {
    return offer.hash ? (this.partials.get(offer.hash)?.byteLength ?? 0) : 0;
  }

  async open(offer: Offer, offset: number, onAbort: () => void) {
    await this.beforeOpen?.(offer);
    const prefix =
      (offer.hash && this.partials.get(offer.hash)?.slice(0, offset)) || new Uint8Array();
    const download = new Download(offer, offset, prefix, this, onAbort);
    this.downloads.push(download);
    return download;
  }

  async dropIncomplete(offer: Offer) {
    if (offer.hash) this.partials.delete(offer.hash);
    this.dropped.push(offer.fileId);
  }

  archive(name: string | undefined, onAbort: () => void) {
    if (!this.zips) return null;
    const archive = new MemoryArchive(name, this, onAbort);
    this.archives.push(archive);
    return archive;
  }

  /** The last download or archive entry of `fileId`. */
  file(fileId: string): Download | undefined {
    const all = [...this.downloads, ...this.archives.flatMap((a) => a.entries)];
    return all.findLast((d) => d.offer.fileId === fileId);
  }
}

export type HookEvent =
  | { hook: "progress"; row: Row }
  | { hook: "bytes"; direction: Direction; count: number }
  | { hook: "finished"; entry: Finished }
  | { hook: "batchDone"; info: BatchInfo }
  | { hook: "removed"; fileId: string }
  | { hook: "error"; message: string }
  | { hook: "bye" };

export class RecordingHooks implements Hooks {
  readonly events: HookEvent[] = [];

  progress(row: Row) {
    this.events.push({ hook: "progress", row });
  }
  bytes(direction: Direction, count: number) {
    this.events.push({ hook: "bytes", direction, count });
  }
  finished(entry: Finished) {
    this.events.push({ hook: "finished", entry });
  }
  batchDone(info: BatchInfo) {
    this.events.push({ hook: "batchDone", info });
  }
  removed(fileId: string) {
    this.events.push({ hook: "removed", fileId });
  }
  error(message: string) {
    this.events.push({ hook: "error", message });
  }
  bye() {
    this.events.push({ hook: "bye" });
  }

  of<T extends HookEvent["hook"]>(hook: T): Extract<HookEvent, { hook: T }>[] {
    return this.events.filter((e) => e.hook === hook) as Extract<HookEvent, { hook: T }>[];
  }

  /** Latest row for `fileId`. */
  row(fileId: string): Row | undefined {
    return this.of("progress").findLast((e) => e.row.id === fileId)?.row;
  }

  finishedOf(fileId: string): Finished | undefined {
    return this.of("finished").find((e) => e.entry.id === fileId)?.entry;
  }
}

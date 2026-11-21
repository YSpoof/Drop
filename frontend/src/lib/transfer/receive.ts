//! Receiver (D3): offers from `meta`, at most one current receive, chunk-aligned resume, a
//! mandatory `resume` answer, credits every 1 MiB of accepted bytes, a size check before
//! `ack`, and one zip per pull batch. Every write runs on one promise chain whose links each
//! catch, and every queued step re-checks that its receive is still the current one.

import { FileTooLargeError } from "./errors";
import { CREDIT_BATCH, unpackFrame, type StartMessage } from "./protocol";
import type { Archive, Hooks, Link, Offer, Row, Sink, Writer } from "./types";
import { Batch, errorMessage } from "./util";

/** How long frames may still arrive after `done` before the size is checked. */
export const DONE_GRACE = 5_000;

/** Files pulled together with `pull-batch`, saved into one archive when the sink zips. */
interface Group {
  ids: Set<string>;
  archive: Archive | null;
}

interface Receive {
  offer: Offer;
  streamId: number;
  /** Set when `resume` is sent; frames before it are dropped. */
  resumed: boolean;
  writer: Writer | null;
  archive: Archive | null;
  written: number;
  credited: number;
  done: boolean;
  /** How a writer that opens after this receive ended must be aborted. */
  discard: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

const ignore = () => undefined;

export class Receiver {
  /** Local download mode: in auto mode folder files go into one zip per sender batch. */
  manual = false;
  private readonly offers = new Map<string, Offer>();
  /** Offers pulled locally; in manual mode only these may start. */
  private readonly pulled = new Set<string>();
  private readonly groups = new Map<string, Group>();
  /** Auto-mode folder zip, finalized on `batch-done`. */
  private auto: Archive | null = null;
  private current: Receive | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly batch = new Batch("received");
  private closed = false;

  constructor(
    private readonly link: Link,
    private readonly sink: Sink,
    private readonly hooks: Hooks,
  ) {}

  onMeta(offer: Offer) {
    if (this.closed) return;
    this.offers.set(offer.fileId, offer);
    this.hooks.progress(row(offer, "pending", 0));
  }

  pull(fileId: string) {
    if (this.closed || !this.offers.has(fileId)) return;
    this.pulled.add(fileId);
    this.link.sendControl({ type: "pull", fileId });
  }

  /** Pulls several offers into one archive (when the sink zips), finalized after the last. */
  pullBatch(fileIds: string[], zipName?: string) {
    const ids = fileIds.filter((id) => this.offers.has(id));
    if (this.closed || !ids.length) return;
    const group: Group = { ids: new Set(ids), archive: null };
    group.archive = this.sink.archive(zipName, () => this.archiveAborted(group));
    for (const id of ids) {
      this.groups.set(id, group);
      this.pulled.add(id);
    }
    this.link.sendControl({ type: "pull-batch", fileIds: ids });
  }

  /** The user removed an offer or a download: forget it, delete its partial, tell the peer. */
  dismiss(fileId: string) {
    if (!this.forget(fileId)) return;
    this.link.sendControl({ type: "download-aborted", fileId });
    this.hooks.removed(fileId);
  }

  /** The peer cancelled a file it sends. */
  onCancel(fileId: string) {
    if (this.forget(fileId)) this.hooks.removed(fileId);
  }

  /**
   * Always answers: `resume` for a known offer, `download-aborted` for an unknown one or,
   * in manual mode, for one not pulled (it stays pending).
   */
  onStart(message: StartMessage) {
    if (this.closed) return;
    const { fileId } = message;
    const offer = this.offers.get(fileId);
    if (!offer || (this.manual && !this.pulled.has(fileId))) {
      this.link.sendControl({ type: "download-aborted", fileId });
      return;
    }
    this.offers.delete(fileId);
    this.pulled.delete(fileId);
    if (this.current) this.interrupt(this.current);
    const rx: Receive = {
      offer,
      streamId: message.streamId,
      resumed: false,
      writer: null,
      archive: this.archiveFor(offer),
      written: 0,
      credited: 0,
      done: false,
      discard: false,
    };
    this.current = rx;
    this.hooks.progress(row(offer, "in-progress", 0));
    this.enqueue(rx, () => this.open(rx, message.chunkSize));
  }

  /** Writes a frame of the current stream after its `resume`; drops anything else. */
  onFrame(frame: Uint8Array) {
    const parsed = unpackFrame(frame);
    const rx = this.current;
    if (!parsed || !rx?.resumed || parsed.streamId !== rx.streamId) return;
    this.enqueue(rx, () => this.write(rx, parsed.bytes));
  }

  onDone(fileId: string) {
    const rx = this.current;
    if (rx?.offer.fileId !== fileId) return;
    this.enqueue(rx, async () => {
      if (rx !== this.current) return;
      rx.done = true;
      if (rx.written >= rx.offer.size) return this.finish(rx);
      rx.timer = setTimeout(() => this.enqueue(rx, () => this.finish(rx)), DONE_GRACE);
    });
  }

  /** The sender's batch ended: close the auto-mode zip and the receive batch. */
  onBatchDone() {
    this.chain(async () => {
      if (this.closed) return;
      const archive = this.auto;
      this.auto = null;
      if (archive) this.finalize(archive);
      const info = this.batch.close();
      if (info) this.hooks.batchDone(info);
    }, ignore);
  }

  /** Peer loss: snapshot the open writer and archives, reset, then close the snapshot. */
  close() {
    if (this.closed) return;
    this.closed = true;
    const rx = this.current;
    const archives = new Set([this.auto, ...[...this.groups.values()].map((g) => g.archive)]);
    this.current = null;
    this.auto = null;
    this.offers.clear();
    this.pulled.clear();
    this.groups.clear();
    if (rx) clearTimeout(rx.timer);
    void (async () => {
      await rx?.writer?.abort(false).catch(ignore);
      for (const archive of archives) await archive?.finalize().catch(ignore);
    })();
  }

  private async open(rx: Receive, chunkSize: number) {
    const { offer } = rx;
    const offset = rx.archive ? 0 : await this.resumeOffset(offer, chunkSize);
    const writer = rx.archive
      ? await rx.archive.entry(offer)
      : await this.sink.open(offer, offset, () => this.userAborted(rx));
    if (rx !== this.current) {
      await writer.abort(rx.discard);
      return;
    }
    rx.writer = writer;
    rx.written = offset;
    rx.credited = offset;
    rx.resumed = true;
    const hash = offer.hash ?? "";
    this.link.sendControl({ type: "resume", fileId: offer.fileId, hash, bytesOffset: offset });
    if (offset > 0) this.hooks.progress(row(offer, "in-progress", offset));
  }

  /** The retained partial aligned down to the chunk size; 0 unless it is shorter than the file. */
  private async resumeOffset(offer: Offer, chunkSize: number): Promise<number> {
    if (!offer.hash || chunkSize <= 0) return 0;
    const offset = await this.sink.resumeOffset(offer);
    if (offset >= offer.size) return 0;
    return offset - (offset % chunkSize);
  }

  private async write(rx: Receive, bytes: Uint8Array) {
    if (rx !== this.current || !rx.writer) return;
    await rx.writer.write(bytes);
    if (rx !== this.current) return;
    rx.written += bytes.byteLength;
    this.hooks.bytes("received", bytes.byteLength);
    const { written, offer } = rx;
    if (written - rx.credited >= CREDIT_BATCH || written >= offer.size) {
      rx.credited = written;
      this.link.sendControl({ type: "credit", fileId: offer.fileId, bytesWritten: written });
    }
    this.hooks.progress(row(offer, "in-progress", written));
    if (rx.done && written >= offer.size) await this.finish(rx);
  }

  /** Checks the size, then closes and sends `ack`, or discards and sends `cancel`. */
  private async finish(rx: Receive) {
    if (rx !== this.current) return;
    if (rx.written !== rx.offer.size) {
      this.fail(rx, `Size mismatch: got ${rx.written} of ${rx.offer.size} bytes`);
      return;
    }
    this.end(rx, false);
    try {
      await rx.writer!.close();
    } catch (error) {
      this.report(rx, errorMessage(error, "Failed to finalize download"));
      return;
    }
    this.link.sendControl({ type: "ack", fileId: rx.offer.fileId });
    this.hooks.finished(this.batch.entry(entryOf(rx.offer), "completed"));
    this.leaveGroup(rx.offer.fileId);
  }

  /** The current receive failed: discard it and tell the sender. */
  private fail(rx: Receive, message: string) {
    if (rx !== this.current) return;
    this.end(rx, true);
    void rx.writer?.abort(true).catch(ignore);
    this.report(rx, message);
  }

  private report(rx: Receive, message: string) {
    const { offer } = rx;
    this.link.sendControl({ type: "cancel", fileId: offer.fileId, reason: message });
    this.hooks.error(message);
    this.hooks.finished(this.batch.entry(entryOf(offer), "failed", message));
    this.leaveGroup(offer.fileId);
  }

  /** A new `start` replaced an unfinished receive: keep its partial, report it failed. */
  private interrupt(rx: Receive) {
    this.end(rx, false);
    void rx.writer?.abort(false).catch(ignore);
    this.hooks.finished(this.batch.entry(entryOf(rx.offer), "failed", "Interrupted"));
    this.leaveGroup(rx.offer.fileId);
  }

  /** The sink cannot hold this file: back to pending, so the sender moves on to the next. */
  private refuse(rx: Receive, message: string) {
    if (rx !== this.current) return;
    this.end(rx, true);
    void rx.writer?.abort(true).catch(ignore);
    this.toPending(rx.offer);
    this.hooks.error(message);
  }

  /** The user stopped the download outside the app: keep the partial, back to pending. */
  private userAborted(rx: Receive) {
    if (rx !== this.current) return;
    this.end(rx, false);
    void rx.writer?.abort(false).catch(ignore);
    this.toPending(rx.offer);
  }

  /** The user stopped a pull-batch zip: every file of the batch goes back to pending. */
  private archiveAborted(group: Group) {
    for (const id of group.ids) this.groups.delete(id);
    for (const id of group.ids) {
      const rx = this.current;
      if (rx?.offer.fileId === id) {
        this.userAborted(rx);
        continue;
      }
      const offer = this.offers.get(id);
      if (offer) this.toPending(offer);
    }
  }

  private toPending(offer: Offer) {
    this.offers.set(offer.fileId, offer);
    this.pulled.delete(offer.fileId);
    this.leaveGroup(offer.fileId);
    this.link.sendControl({ type: "download-aborted", fileId: offer.fileId });
    this.hooks.progress(row(offer, "pending", 0));
  }

  /** Drops `fileId` from every stage and deletes its partial; `false` when unknown. */
  private forget(fileId: string): boolean {
    const rx = this.current?.offer.fileId === fileId ? this.current : null;
    const offer = rx?.offer ?? this.offers.get(fileId);
    if (!offer) return false;
    this.offers.delete(fileId);
    this.pulled.delete(fileId);
    this.leaveGroup(fileId);
    if (rx) this.end(rx, true);
    void (async () => {
      await rx?.writer?.abort(true).catch(ignore);
      if (offer.hash) await this.sink.dropIncomplete(offer).catch(ignore);
    })();
    return true;
  }

  /** Detaches `rx` so queued steps, late frames and a late writer skip it. */
  private end(rx: Receive, discard: boolean) {
    rx.discard = discard;
    clearTimeout(rx.timer);
    if (this.current === rx) this.current = null;
  }

  private leaveGroup(fileId: string) {
    const group = this.groups.get(fileId);
    if (!group) return;
    this.groups.delete(fileId);
    group.ids.delete(fileId);
    if (!group.ids.size && group.archive) this.finalize(group.archive);
  }

  private finalize(archive: Archive) {
    archive.finalize().catch((error) => {
      this.hooks.error(errorMessage(error, "Failed to finalize zip download"));
    });
  }

  /** The pull-batch archive, the auto-mode folder zip, or `null` for a direct download. */
  private archiveFor(offer: Offer): Archive | null {
    const group = this.groups.get(offer.fileId);
    if (group) return group.archive;
    const slash = offer.name.indexOf("/");
    if (this.manual || slash <= 0) return null;
    this.auto ??= this.sink.archive(`${offer.name.slice(0, slash)}.zip`, () => {
      this.autoAborted();
    });
    return this.auto;
  }

  private autoAborted() {
    const archive = this.auto;
    this.auto = null;
    const rx = this.current;
    if (rx && rx.archive === archive) this.userAborted(rx);
  }

  /** Runs `step` for `rx` after every earlier step; a failure ends only `rx`. */
  private enqueue(rx: Receive, step: () => Promise<void>) {
    this.chain(step, (error) => {
      if (error instanceof FileTooLargeError) this.refuse(rx, error.message);
      else this.fail(rx, errorMessage(error, "Failed to write received file"));
    });
  }

  /** Appends to the write chain. The chain never rejects, so a failure never skips later steps. */
  private chain(step: () => Promise<void>, onError: (error: unknown) => void) {
    this.queue = this.queue.then(step).catch(onError).catch(ignore);
  }
}

function row(offer: Offer, status: Row["status"], bytesTransferred: number): Row {
  return {
    id: offer.fileId,
    name: offer.name,
    size: offer.size,
    direction: "received",
    status,
    bytesTransferred,
  };
}

function entryOf(offer: Offer) {
  return { id: offer.fileId, name: offer.name, size: offer.size };
}

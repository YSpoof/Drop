//! Sender (D2): one sequential loop per connection. It announces queued files with `meta`,
//! then streams one file at a time (pulled files for a manual peer, announce order for an
//! automatic one): `start` with a new stream ID, wait for its `resume`, frames within the
//! window, `done`, wait for `ack`. One `AbortController` per file is the only stop source.

import {
  ACK_TIMEOUT,
  RESUME_TIMEOUT,
  SEND_WINDOW,
  packFrame,
  type CreditMessage,
  type ResumeMessage,
} from "./protocol";
import type { Hooks, Link, Outgoing, Row, Source } from "./types";
import { Batch, Stop, stopOf, within } from "./util";

interface Offered {
  item: Outgoing;
  /** The receiver stopped this download; it waits for a new pull. */
  aborted: boolean;
}

/** The file being streamed. */
interface Active {
  item: Outgoing;
  streamId: number;
  stop: AbortController;
  /** Pending until the `resume` that answers this `start`. */
  resume: PromiseWithResolvers<number> | null;
  resumed: boolean;
  /** Set once `done` is sent. */
  ack: PromiseWithResolvers<void> | null;
  credit: PromiseWithResolvers<void> | null;
  /** Highest absolute offset the receiver confirmed. */
  confirmed: number;
}

export class Sender {
  /** Announced on this connection and not finished, in announce order. */
  private readonly offers = new Map<string, Offered>();
  /** Finished on this connection: never announced again. */
  private readonly finished = new Set<string>();
  private pulls: string[] = [];
  private peerManual = true;
  private streamId = 0;
  private sentSinceBatch = false;
  private readonly batch = new Batch("sent");
  private active: Active | null = null;
  private wake = Promise.withResolvers<void>();
  private closed = false;

  constructor(
    private readonly link: Link,
    private readonly source: Source,
    private readonly hooks: Hooks,
  ) {}

  /** The send loop; returns after `close()`. */
  async run(): Promise<void> {
    while (!this.closed) {
      this.wake = Promise.withResolvers();
      this.announce();
      const next = this.next();
      if (next) {
        await this.send(next);
        continue;
      }
      this.endBatch();
      await this.wake.promise;
    }
  }

  /** Peer loss: stops the current file and ends the loop. */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.active?.stop.abort(new Stop("lost"));
    this.wake.resolve();
  }

  /** The app's send queue changed. */
  queueChanged() {
    if (this.closed) return;
    this.announce();
    this.wake.resolve();
  }

  /** The user removed a file from the send queue. */
  cancel(fileId: string) {
    this.finished.add(fileId);
    if (!this.offers.has(fileId)) {
      this.hooks.removed(fileId);
      return;
    }
    this.link.sendControl({ type: "cancel", fileId });
    this.onCancel(fileId);
  }

  onDownloadMode(manual: boolean) {
    this.peerManual = manual;
    this.wake.resolve();
  }

  onPull(fileIds: string[]) {
    for (const fileId of fileIds) {
      const offered = this.offers.get(fileId);
      if (!offered) continue;
      offered.aborted = false;
      if (!this.pulls.includes(fileId)) this.pulls.push(fileId);
    }
    this.wake.resolve();
  }

  /** Only the wait of the current `start` takes a `resume`; any other one is dropped. */
  onResume(message: ResumeMessage) {
    const active = this.active;
    if (!active?.resume || active.item.id !== message.fileId) return;
    const { item } = active;
    const valid = message.hash === item.hash && message.bytesOffset < item.size;
    const offset = valid ? message.bytesOffset : 0;
    const wait = active.resume;
    active.resume = null;
    active.resumed = true;
    active.confirmed = offset;
    wait.resolve(offset);
  }

  onCredit(message: CreditMessage) {
    const active = this.active;
    if (!active?.resumed || active.item.id !== message.fileId) return;
    if (message.bytesWritten <= active.confirmed) return;
    active.confirmed = message.bytesWritten;
    if (message.bytesWritten < active.item.size) {
      this.hooks.progress(row(active.item, "in-progress", message.bytesWritten));
    }
    active.credit?.resolve();
    active.credit = null;
  }

  onAck(fileId: string) {
    const active = this.active;
    if (active?.ack && active.item.id === fileId) active.ack.resolve();
  }

  /**
   * The peer does not want the file: it leaves the queue. Applied at once (not when the
   * loop unwinds) so that messages right behind it see the new state.
   */
  onCancel(fileId: string) {
    if (!this.offers.has(fileId)) return;
    this.stopActive(fileId, "cancelled");
    this.drop(fileId);
    this.hooks.removed(fileId);
  }

  /** The receiver stopped or dismissed the download: back to pending until pulled again. */
  onDownloadAborted(fileId: string) {
    if (!this.offers.has(fileId)) return;
    this.stopActive(fileId, "aborted");
    this.reset(fileId);
  }

  private stopActive(fileId: string, kind: "aborted" | "cancelled") {
    const active = this.active;
    if (active?.item.id !== fileId) return;
    this.sentSinceBatch ||= kind === "cancelled";
    active.stop.abort(new Stop(kind));
  }

  private announce() {
    for (const item of this.source.list()) {
      if (this.offers.has(item.id) || this.finished.has(item.id)) continue;
      this.link.sendControl({
        type: "meta",
        fileId: item.id,
        name: item.name,
        size: item.size,
        mime: item.mime,
        hash: item.hash,
      });
      this.offers.set(item.id, { item, aborted: false });
      this.hooks.progress(row(item, "pending", 0));
    }
  }

  /** The first pulled file for a manual peer, else the first announced one. */
  private next(): Outgoing | null {
    if (!this.peerManual) {
      return [...this.offers.values()].find((offered) => !offered.aborted)?.item ?? null;
    }
    while (this.pulls.length) {
      const offered = this.offers.get(this.pulls[0]!);
      if (offered && !offered.aborted) return offered.item;
      this.pulls.shift();
    }
    return null;
  }

  private endBatch() {
    if (!this.sentSinceBatch) return;
    this.sentSinceBatch = false;
    this.link.sendControl({ type: "batch-done" });
    const info = this.batch.close();
    if (info) this.hooks.batchDone(info);
  }

  /** Streams one file and applies the outcome. */
  private async send(item: Outgoing) {
    this.streamId = (this.streamId + 1) >>> 0;
    const active: Active = {
      item,
      streamId: this.streamId,
      stop: new AbortController(),
      resume: null,
      resumed: false,
      ack: null,
      credit: null,
      confirmed: 0,
    };
    this.active = active;
    let stop: Stop | null = null;
    try {
      await this.stream(active);
    } catch (error) {
      stop = this.link.closed.aborted ? new Stop("lost") : stopOf(error, active.stop.signal);
    }
    this.active = null;
    this.settle(item, stop);
  }

  private async stream(active: Active) {
    const { item, streamId } = active;
    const { signal } = active.stop;
    const chunkSize = this.link.chunkSize;
    active.resume = Promise.withResolvers();
    this.link.sendControl({ type: "start", fileId: item.id, chunkSize, streamId });
    const offset = await within(active.resume.promise, signal, RESUME_TIMEOUT, "No resume");
    this.hooks.progress(row(item, "in-progress", offset));

    for (let sent = offset; sent < item.size;) {
      const length = Math.min(chunkSize, item.size - sent);
      await this.room(active, sent, length);
      const bytes = await this.source.read(item, sent, length, signal);
      if (bytes.byteLength !== length) throw new Stop("failed", "Short read");
      signal.throwIfAborted();
      await within(this.link.sendFrame(packFrame(streamId, bytes)), signal);
      this.hooks.bytes("sent", length);
      sent += length;
    }

    active.ack = Promise.withResolvers();
    this.link.sendControl({ type: "done", fileId: item.id });
    await within(active.ack.promise, signal, ACK_TIMEOUT, "No ack");
  }

  /** Waits until `length` more bytes fit the window past the confirmed offset. */
  private async room(active: Active, sent: number, length: number) {
    while (sent - active.confirmed + length > SEND_WINDOW) {
      active.credit = Promise.withResolvers();
      await within(active.credit.promise, active.stop.signal);
    }
  }

  private settle(item: Outgoing, stop: Stop | null) {
    switch (stop?.kind) {
      case undefined:
        this.drop(item.id);
        this.sentSinceBatch = true;
        this.hooks.finished(this.batch.entry(item, "completed"));
        break;
      case "failed":
        this.link.sendControl({ type: "cancel", fileId: item.id, reason: stop.message });
        this.drop(item.id);
        this.sentSinceBatch = true;
        this.hooks.finished(this.batch.entry(item, "failed", stop.message));
        break;
      case "cancelled":
      case "aborted":
      case "lost":
        // Cancel and abort were applied when they arrived; a lost link ends the loop.
        break;
    }
  }

  private drop(fileId: string) {
    this.offers.delete(fileId);
    this.finished.add(fileId);
    this.pulls = this.pulls.filter((id) => id !== fileId);
  }

  private reset(fileId: string) {
    const offered = this.offers.get(fileId);
    if (!offered) return;
    offered.aborted = true;
    this.pulls = this.pulls.filter((id) => id !== fileId);
    this.hooks.progress(row(offered.item, "pending", 0));
  }
}

function row(item: Outgoing, status: Row["status"], bytesTransferred: number): Row {
  return {
    id: item.id,
    name: item.name,
    size: item.size,
    direction: "sent",
    status,
    bytesTransferred,
  };
}

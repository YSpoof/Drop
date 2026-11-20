//! Engine boundary (D4): the engine reaches the peer through a `Link`, the UI through
//! `Hooks`, and bytes through a `Source` (outgoing) and a `Sink` (incoming).

import type { ControlMessage, MetaMessage } from "./protocol";

/** One peer connection. The owner feeds inbound traffic to `Engine.onControl`/`onFrame`. */
export interface Link {
  /** File bytes per frame, from `chunkSizeFor(maxMessageSize)`. */
  readonly chunkSize: number;
  /** Aborts when either channel closes; the engine tears down on it. */
  readonly closed: AbortSignal;
  /** Queues a control message; a no-op once closed. */
  sendControl(message: ControlMessage): void;
  /** Resolves when the channel accepts the frame (backpressure); rejects once closed. */
  sendFrame(frame: Uint8Array): Promise<void>;
}

export type Direction = "sent" | "received";

/** A file announced by the peer with `meta`. */
export type Offer = Omit<MetaMessage, "type">;

/** A file to send. `hash` is `fileIdentity(name, size, lastModified)`. */
export interface Outgoing {
  id: string;
  name: string;
  size: number;
  mime: string;
  hash: string;
}

export interface Source {
  /** The current send queue in order; the sender announces items it has not announced yet. */
  list(): readonly Outgoing[];
  /** Exactly `length` bytes at `offset`; throws when the file cannot be read. */
  read(item: Outgoing, offset: number, length: number, signal: AbortSignal): Promise<Uint8Array>;
}

/** An open download. */
export interface Writer {
  /** Resolves once the download stream accepted the bytes. */
  write(bytes: Uint8Array): Promise<void>;
  /** Finalizes the download. */
  close(): Promise<void>;
  /**
   * Stops the download; `discard` also deletes the partial file. For an archive entry this
   * never fails the zip: an entry with no bytes yet is left out, one already streaming stays
   * in the zip truncated at its last byte.
   */
  abort(discard: boolean): Promise<void>;
}

/** One zip download holding several entries. */
export interface Archive {
  entry(offer: Offer): Promise<Writer>;
  finalize(): Promise<void>;
}

export interface Sink {
  /** Bytes of a retained partial for `offer` (0 when none). */
  resumeOffset(offer: Offer): Promise<number>;
  /** Opens a download at `offset`. `onAbort` fires when the user stops it outside the app. */
  open(offer: Offer, offset: number, onAbort: () => void): Promise<Writer>;
  /** Deletes the partial file of `offer`, if any. */
  dropIncomplete(offer: Offer): Promise<void>;
  /** A new zip download, or `null` when the platform saves files directly (desktop). */
  archive(name: string | undefined, onAbort: () => void): Archive | null;
}

/** A transfer row update (same shape as `TransferItem`). */
export interface Row {
  id: string;
  name: string;
  size: number;
  direction: Direction;
  status: "pending" | "in-progress";
  bytesTransferred: number;
}

/** A finished file (same shape as `HistoryEntry`, plus the failure reason). */
export interface Finished {
  id: string;
  name: string;
  size: number;
  direction: Direction;
  status: "completed" | "failed";
  timestamp: number;
  batchId: string;
  fileCountInBatch: number;
  reason?: string;
}

/** A batch closed after at least one finished file (same shape as `BatchDoneInfo`). */
export interface BatchInfo {
  batchId: string;
  direction: Direction;
  fileCountInBatch: number;
}

export interface Hooks {
  /** Pending offers, resets to pending, and in-progress byte counts. */
  progress(row: Row): void;
  /** File bytes moved, for the speed and totals stats. */
  bytes(direction: Direction, count: number): void;
  /** Terminal state of a file: completed or failed. */
  finished(entry: Finished): void;
  batchDone(info: BatchInfo): void;
  /** The file left the session: cancelled by either side, or dismissed locally. */
  removed(fileId: string): void;
  /** A receive-side failure worth a toast. */
  error(message: string): void;
  /** The peer said `bye`. */
  bye(): void;
}

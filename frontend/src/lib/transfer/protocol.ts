//! Wire protocol shared with the Rust CLI (`crates/cli/src/protocol.rs`): JSON control
//! messages on `ctrl`, and `files` frames of a 4-byte big-endian stream ID plus file bytes.

/** Unconfirmed file bytes the sender may keep in flight. */
export const SEND_WINDOW = 8 * 1024 * 1024;
/** The receiver sends a credit every this many accepted bytes. */
export const CREDIT_BATCH = 1024 * 1024;
/** Largest whole `files` frame (header + file bytes). */
export const MAX_CHUNK = 256 * 1024;
/** Frame size used when the SCTP maximum is zero, infinite or unknown. */
export const FALLBACK_CHUNK = 64 * 1024;
/** Bytes of the stream ID that starts every `files` frame. */
export const FRAME_HEADER = 4;
/** How long the sender waits for the `resume` that answers its `start`. */
export const RESUME_TIMEOUT = 30_000;
/** How long the sender waits for the `ack` that answers its `done`. */
export const ACK_TIMEOUT = 15_000;

export interface MetaMessage {
  type: "meta";
  fileId: string;
  name: string;
  size: number;
  mime: string;
  hash?: string;
}

export interface StartMessage {
  type: "start";
  fileId: string;
  chunkSize: number;
  streamId: number;
  offset?: number;
}

export interface ResumeMessage {
  type: "resume";
  fileId: string;
  hash: string;
  bytesOffset: number;
}

export interface CreditMessage {
  type: "credit";
  fileId: string;
  bytesWritten: number;
}

export interface CancelMessage {
  type: "cancel";
  fileId: string;
  reason?: string;
}

export type ControlMessage =
  | MetaMessage
  | StartMessage
  | ResumeMessage
  | CreditMessage
  | CancelMessage
  | { type: "done"; fileId: string }
  | { type: "ack"; fileId: string }
  | { type: "batch-done" }
  | { type: "bye" }
  | { type: "download-mode"; manual: boolean }
  | { type: "pull"; fileId: string }
  | { type: "pull-batch"; fileIds: string[] }
  | { type: "download-aborted"; fileId: string };

export type ControlType = ControlMessage["type"];

/** Field kinds; a trailing `?` marks an optional field. */
type Kind = "str" | "uint" | "u32" | "bool" | "strs";
type Shape = Record<string, Kind | `${Kind}?`>;

const SHAPES: Record<ControlType, Shape> = {
  meta: { fileId: "str", name: "str", size: "uint", mime: "str?", hash: "str?" },
  start: { fileId: "str", chunkSize: "u32", streamId: "u32", offset: "uint?" },
  resume: { fileId: "str", hash: "str", bytesOffset: "uint" },
  credit: { fileId: "str", bytesWritten: "uint" },
  done: { fileId: "str" },
  ack: { fileId: "str" },
  "batch-done": {},
  bye: {},
  cancel: { fileId: "str", reason: "str?" },
  "download-mode": { manual: "bool" },
  pull: { fileId: "str" },
  "pull-batch": { fileIds: "strs" },
  "download-aborted": { fileId: "str" },
};

function matches(kind: Kind, value: unknown): boolean {
  switch (kind) {
    case "str":
      return typeof value === "string";
    case "bool":
      return typeof value === "boolean";
    case "uint":
      return Number.isSafeInteger(value) && (value as number) >= 0;
    case "u32":
      return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffff_ffff;
    case "strs":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
  }
}

export function encodeControl(message: ControlMessage): string {
  return JSON.stringify(message);
}

/** Parses a `ctrl` text frame; `null` for bad JSON, an unknown type or a malformed field. */
export function decodeControl(text: string): ControlMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const input = raw as Record<string, unknown>;
  const type = input.type;
  if (typeof type !== "string" || !Object.hasOwn(SHAPES, type)) return null;

  const out: Record<string, unknown> = { type };
  for (const [field, spec] of Object.entries(SHAPES[type as ControlType])) {
    const optional = spec.endsWith("?");
    const value = input[field];
    if (value === undefined && optional) continue;
    if (!matches(spec.replace("?", "") as Kind, value)) return null;
    out[field] = value;
  }
  if (type === "meta") out.mime ??= "";
  return out as unknown as ControlMessage;
}

/** One `files` frame: `streamId` as u32 big-endian, then `bytes`. */
export function packFrame(streamId: number, bytes: Uint8Array): Uint8Array {
  const frame = new Uint8Array(FRAME_HEADER + bytes.byteLength);
  new DataView(frame.buffer).setUint32(0, streamId >>> 0);
  frame.set(bytes, FRAME_HEADER);
  return frame;
}

/** Splits a `files` frame; `null` when it is shorter than the header. */
export function unpackFrame(frame: Uint8Array): { streamId: number; bytes: Uint8Array } | null {
  if (frame.byteLength < FRAME_HEADER) return null;
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  return { streamId: view.getUint32(0), bytes: frame.subarray(FRAME_HEADER) };
}

/** File bytes per frame so that a whole frame fits the negotiated SCTP maximum. */
export function chunkSizeFor(maxMessageSize: number | null | undefined): number {
  const valid =
    typeof maxMessageSize === "number" && Number.isFinite(maxMessageSize) && maxMessageSize > 0;
  const frame = valid ? Math.min(maxMessageSize, MAX_CHUNK) : FALLBACK_CHUNK;
  return Math.max(frame - FRAME_HEADER, 1);
}

/** Identity shared with the CLI (`meta.hash`, `resume.hash`): `name|size|mtimeMs`. */
export function fileIdentity(name: string, size: number, mtimeMs: number): string {
  return `${name}|${size}|${mtimeMs}`;
}

import { filesystem, os } from "@neutralinojs/lib";

import { getNativeSocket } from "#lib/adapters/native/neutralinoClient.js";
import { tryStats } from "#lib/adapters/native/neutralinoFs.js";
import { unwatchFolder, watchFolder } from "#lib/adapters/native/neutralinoWatch.js";
import type { NativeApi } from "#lib/ports/nativeApi.js";

/** Appends are batched to this size: every native call is a base64 WebSocket round-trip. */
const FLUSH_THRESHOLD = 4 * 1024 * 1024;

/** `String.fromCharCode.apply` argument cap. Stays under the engine stack limit. */
const BASE64_STEP = 0x4000;

type NativeReply = {
  id?: string;
  data?: { error?: { message?: string }; success?: boolean };
};

/**
 * Neutralino's client encodes with one `String.fromCharCode` per byte, then `btoa`.
 * A 4 MiB flush blocks the receive loop for a long time, and the sender waits on that write.
 */
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += BASE64_STEP) {
    const slice = bytes.subarray(index, index + BASE64_STEP);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

function appendBinaryFile(path: string, data: ArrayBuffer): Promise<void> {
  const socket = getNativeSocket();
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return filesystem.appendBinaryFile(path, data);
  }

  const id = crypto.randomUUID();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  let settled = false;

  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    socket.removeEventListener("message", onMessage);
    socket.removeEventListener("close", onClose);
    if (error) reject(error);
    else resolve();
  };

  const onClose = () => {
    finish(new Error("Native filesystem socket closed"));
  };

  const onMessage = (event: MessageEvent) => {
    if (typeof event.data !== "string" || !event.data.includes(id)) return;

    let message: NativeReply;
    try {
      message = JSON.parse(event.data) as NativeReply;
    } catch {
      return;
    }
    if (message.id !== id) return;
    if (message.data?.error) {
      finish(new Error(message.data.error.message ?? "Failed to append file"));
      return;
    }
    if (message.data?.success) finish();
  };

  socket.addEventListener("message", onMessage);
  socket.addEventListener("close", onClose);

  try {
    socket.send(
      JSON.stringify({
        id,
        method: "filesystem.appendBinaryFile",
        data: { path, data: encodeBase64(new Uint8Array(data)) },
        accessToken: window.NL_TOKEN || sessionStorage.getItem("NL_TOKEN") || "",
      }),
    );
  } catch (error) {
    finish(error instanceof Error ? error : new Error("Failed to append file"));
  }

  return promise;
}

type OpenStream = {
  path: string;
  chunks: Uint8Array[];
  pending: number;
};

const openStreams = new Map<string, OpenStream>();

async function flush(stream: OpenStream) {
  if (stream.pending === 0) return;

  const merged = new Uint8Array(stream.pending);
  let offset = 0;
  for (const chunk of stream.chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  stream.chunks = [];
  stream.pending = 0;

  await appendBinaryFile(stream.path, merged.buffer as ArrayBuffer);
}

export const neutralinoApi: NativeApi = {
  getDownloadsPath() {
    return os.getPath("downloads");
  },

  async pickFolder(defaultPath?: string) {
    const selected = await os.showFolderDialog("Escolher pasta", { defaultPath });
    return selected || null;
  },

  watchFolder,

  unwatchFolder,

  async pathExists(path: string) {
    return (await tryStats(path)) !== null;
  },

  joinPath(dir: string, ...parts: string[]) {
    return filesystem.getJoinedPath(dir, ...parts);
  },

  async move(from: string, to: string) {
    try {
      await filesystem.move(from, to);
    } catch {
      await filesystem.copy(from, to);
      await filesystem.remove(from);
    }
  },

  remove(path: string) {
    return filesystem.remove(path);
  },

  async fileSize(path: string) {
    return (await tryStats(path))?.size ?? null;
  },

  async listDir(dir: string) {
    try {
      const entries = await filesystem.readDirectory(dir);
      return entries.map((entry) => entry.entry).filter((entry) => entry !== "." && entry !== "..");
    } catch {
      return [];
    }
  },

  ensureDir(path: string) {
    return filesystem.createDirectory(path);
  },

  async openWriteStream(path: string, start = 0) {
    // A non-zero start always equals the current size of the partial file, so appending
    // resumes it. Starting from scratch has to truncate whatever is already there.
    if (start === 0) await filesystem.writeBinaryFile(path, new ArrayBuffer(0));

    const id = crypto.randomUUID();
    openStreams.set(id, { path, chunks: [], pending: 0 });
    return id;
  },

  async writeStreamChunk(id: string, data: ArrayBuffer) {
    const stream = openStreams.get(id);
    if (!stream) throw new Error(`Unknown write stream: ${id}`);

    stream.chunks.push(new Uint8Array(data));
    stream.pending += data.byteLength;
    if (stream.pending >= FLUSH_THRESHOLD) await flush(stream);
  },

  async closeWriteStream(id: string) {
    const stream = openStreams.get(id);
    if (!stream) throw new Error(`Unknown write stream: ${id}`);

    try {
      await flush(stream);
    } finally {
      openStreams.delete(id);
    }
  },

  async abortWriteStream(id: string) {
    openStreams.delete(id);
  },

  readFileChunk(filePath: string, start: number, length: number) {
    return filesystem.readBinaryFile(filePath, { pos: start, size: length });
  },
};

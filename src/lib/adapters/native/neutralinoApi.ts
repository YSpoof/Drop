import { filesystem, os } from "@neutralinojs/lib";

import { tryStats } from "#lib/adapters/native/neutralinoFs.js";
import { unwatchFolder, watchFolder } from "#lib/adapters/native/neutralinoWatch.js";
import type { NativeApi } from "#lib/ports/nativeApi.js";

/** Appends are batched to this size: every native call is a base64 WebSocket round-trip. */
const FLUSH_THRESHOLD = 4 * 1024 * 1024;

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

  await filesystem.appendBinaryFile(stream.path, merged.buffer as ArrayBuffer);
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

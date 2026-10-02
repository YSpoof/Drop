import { filesystem, os, clipboard } from "@neutralinojs/lib";

import { tryStats } from "#lib/adapters/native/neutralinoFs.js";
import { unwatchFolder, watchFolder } from "#lib/adapters/native/neutralinoWatch.js";
import {
  openHttpWrite,
  readViaStreamer,
  type HttpWrite,
} from "#lib/adapters/native/streamerClient.js";
import type { NativeApi } from "#lib/ports/nativeApi.js";

const openStreams = new Map<string, HttpWrite>();

export const neutralinoApi: NativeApi = {
  writeClipboardText(text: string) {
    return clipboard.writeText(text);
  },

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

  async ensureDir(path: string) {
    if (await this.pathExists(path)) return;
    try {
      await filesystem.createDirectory(path);
    } catch (error) {
      if (await this.pathExists(path)) return;
      throw error;
    }
  },

  async openWriteStream(path: string, start = 0) {
    const id = crypto.randomUUID();
    const http = await openHttpWrite(path, start);
    openStreams.set(id, http);
    return id;
  },

  async writeStreamChunk(id: string, data: ArrayBuffer) {
    const stream = openStreams.get(id);
    if (!stream) throw new Error(`Unknown write stream: ${id}`);
    await stream.write(new Uint8Array(data));
  },

  async closeWriteStream(id: string) {
    const stream = openStreams.get(id);
    if (!stream) throw new Error(`Unknown write stream: ${id}`);
    try {
      await stream.close();
    } finally {
      openStreams.delete(id);
    }
  },

  async abortWriteStream(id: string) {
    const stream = openStreams.get(id);
    openStreams.delete(id);
    await stream?.abort();
  },

  readFileChunk(filePath: string, start: number, length: number, signal?: AbortSignal) {
    return readViaStreamer(filePath, start, length, signal);
  },
};

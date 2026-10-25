import { callRpc } from "#lib/adapters/native/goNativeClient.js";
import {
  openHttpWrite,
  readViaStreamer,
  type HttpWrite,
} from "#lib/adapters/native/goStreamerClient.js";
import type { NativeApi } from "#lib/ports/nativeApi.js";

type StatResult = {
  exists: boolean;
  path: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: number;
};

type DirEntry = {
  entry: string;
  path: string;
  type: string;
};

const openStreams = new Map<string, HttpWrite>();

export const goNativeApi: NativeApi = {
  async writeClipboardText(text: string): Promise<void> {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    }
  },

  getDownloadsPath(): Promise<string> {
    return callRpc<string>("fs.getDownloadsPath");
  },

  async pickFolder(defaultPath?: string): Promise<string | null> {
    const selected = await callRpc<string>("dialog.pickFolder", {
      title: "Escolher pasta",
      defaultPath,
    });
    return selected || null;
  },

  async watchFolder(watcherId: string, folderPath: string): Promise<void> {
    await callRpc("watch.start", { watcherId, folderPath });
  },

  async unwatchFolder(watcherId: string): Promise<void> {
    await callRpc("watch.stop", { watcherId });
  },

  async pathExists(path: string): Promise<boolean> {
    const stat = await callRpc<StatResult>("fs.stat", { path });
    return stat.exists;
  },

  joinPath(dir: string, ...parts: string[]): Promise<string> {
    const sep = dir.includes("\\") ? "\\" : "/";
    let res = dir.replace(/[/\\]+$/, "");
    for (const part of parts) {
      const clean = part.replace(/^[/\\]+/, "").replace(/[/\\]+$/, "");
      if (clean) res += sep + clean;
    }
    return Promise.resolve(res);
  },

  async move(from: string, to: string): Promise<void> {
    await callRpc("fs.move", { from, to });
  },

  async remove(path: string): Promise<void> {
    await callRpc("fs.remove", { path });
  },

  async fileSize(path: string): Promise<number | null> {
    const stat = await callRpc<StatResult>("fs.stat", { path });
    return stat.exists ? stat.size : null;
  },

  async listDir(dir: string): Promise<string[]> {
    try {
      const entries = await callRpc<DirEntry[]>("fs.readDir", { path: dir });
      return entries.map((e) => e.entry).filter((entry) => !entry.startsWith("."));
    } catch {
      return [];
    }
  },

  async ensureDir(path: string): Promise<void> {
    await callRpc("fs.mkdir", { path });
  },

  async openWriteStream(path: string, start = 0): Promise<string> {
    const id = crypto.randomUUID();
    const http = await openHttpWrite(path, start);
    openStreams.set(id, http);
    return id;
  },

  async writeStreamChunk(id: string, data: ArrayBuffer): Promise<void> {
    const stream = openStreams.get(id);
    if (!stream) throw new Error(`Unknown write stream: ${id}`);
    await stream.write(new Uint8Array(data));
  },

  async closeWriteStream(id: string): Promise<void> {
    const stream = openStreams.get(id);
    if (!stream) throw new Error(`Unknown write stream: ${id}`);
    try {
      await stream.close();
    } finally {
      openStreams.delete(id);
    }
  },

  async abortWriteStream(id: string): Promise<void> {
    const stream = openStreams.get(id);
    openStreams.delete(id);
    await stream?.abort();
  },

  readFileChunk(
    filePath: string,
    start: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    return readViaStreamer(filePath, start, length, signal);
  },
};

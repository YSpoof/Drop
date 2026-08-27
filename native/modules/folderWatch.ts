import { stat, open, type FileHandle } from "node:fs/promises";

import chokidar, { type FSWatcher } from "chokidar";
import type { BrowserWindow } from "electron";

export type WatchEvent =
  | { type: "add"; watcherId: string; filePath: string; size: number }
  | { type: "unlink"; watcherId: string; filePath: string };

const watchers = new Map<string, FSWatcher>();
const fileLocks = new Map<string, FileHandle>();

export function createFolderWatchHandlers(win: BrowserWindow) {
  return {
    async watchFolder(watcherId: string, folderPath: string): Promise<void> {
      if (watchers.has(watcherId)) return;
      const watcher = chokidar.watch(folderPath, {
        ignoreInitial: true,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        ignored: /(^|[/\\])\../,
      });
      watcher.on("add", async (filePath: string) => {
        try {
          const s = await stat(filePath);
          win.webContents.send("folder-watch-event", {
            type: "add",
            watcherId,
            filePath,
            size: s.size,
          } satisfies WatchEvent);
        } catch {
          /* file vanished before stat */
        }
      });
      watcher.on("unlink", (filePath: string) => {
        win.webContents.send("folder-watch-event", {
          type: "unlink",
          watcherId,
          filePath,
        } satisfies WatchEvent);
      });
      watchers.set(watcherId, watcher);
    },

    async unwatchFolder(watcherId: string): Promise<void> {
      const watcher = watchers.get(watcherId);
      if (!watcher) return;
      await watcher.close();
      watchers.delete(watcherId);
    },

    async lockFile(filePath: string): Promise<void> {
      if (fileLocks.has(filePath)) return;
      try {
        const handle = await open(filePath, "r");
        fileLocks.set(filePath, handle);
      } catch {
        /* best-effort */
      }
    },

    async unlockFile(filePath: string): Promise<void> {
      const handle = fileLocks.get(filePath);
      if (handle) {
        await handle.close().catch(() => {});
        fileLocks.delete(filePath);
      }
    },

    async readFileChunk(filePath: string, start: number, length: number): Promise<ArrayBuffer> {
      let handle = fileLocks.get(filePath);
      let closeAfter = false;

      if (!handle) {
        handle = await open(filePath, "r");
        closeAfter = true;
      }

      try {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead) as ArrayBuffer;
      } finally {
        if (closeAfter) await handle.close().catch(() => {});
      }
    },
  };
}

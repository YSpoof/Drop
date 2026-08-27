import type { FileReaderPort } from "#lib/ports/fileReader.js";
import type { WatcherEvent, WatcherPort } from "#lib/ports/watcher.js";
import type { FileLockManager } from "#lib/services/fileLockManager.js";
import { createQueuedFile, type QueuedFile } from "#lib/utils/files/queue.js";

type Callbacks = {
  onAdd: (groupId: string, file: QueuedFile) => void;
  onRemove: (fileId: string) => void;
};

type WatchedGroupEntry = {
  folderPath: string;
  /** absolute filePath → QueuedFile.id */
  fileMap: Map<string, string>;
};

export class FolderWatcher {
  private watched = new Map<string, WatchedGroupEntry>();
  private unsub: (() => void) | null = null;
  private callbacks: Callbacks | null = null;

  constructor(
    readonly locks: FileLockManager,
    private readonly watcher: WatcherPort,
    private readonly fileReader: FileReaderPort,
  ) {}

  init(onAdd: Callbacks["onAdd"], onRemove: Callbacks["onRemove"]) {
    this.callbacks = { onAdd, onRemove };
    this.unsub ??= this.watcher.onEvent((ev) => void this.handleEvent(ev));
  }

  /**
   * Begin watching a folder group and lock all files already in the queue.
   * @param groupId    Reused as the watcherId (1-to-1)
   * @param folderPath Absolute path to the watched folder
   * @param initial    QueuedFiles already created for this group
   */
  async watchGroup(groupId: string, folderPath: string, initial: QueuedFile[]) {
    const fileMap = new Map<string, string>();
    for (const qf of initial) {
      const absPath = this.fileReader.nativePath(qf.file);
      if (absPath) {
        fileMap.set(absPath, qf.id);
        await this.locks.lock(qf.id, absPath);
      }
    }
    this.watched.set(groupId, { folderPath, fileMap });
    await this.watcher.watch(groupId, folderPath);
  }

  /** Stop watching a group and unlock all its files. */
  async unwatchGroup(groupId: string) {
    const entry = this.watched.get(groupId);
    if (!entry) return;
    await this.watcher.unwatch(groupId);
    for (const fileId of entry.fileMap.values()) {
      await this.locks.unlock(fileId);
    }
    this.watched.delete(groupId);
  }

  destroy() {
    this.unsub?.();
    this.unsub = null;
    this.callbacks = null;
  }

  private async handleEvent(event: WatcherEvent) {
    const cb = this.callbacks;
    if (!cb) return;

    const entry = this.watched.get(event.watcherId);
    if (!entry) return;

    switch (event.type) {
      case "add": {
        if (entry.fileMap.has(event.filePath)) return; // already known

        const sep = entry.folderPath.includes("\\") ? "\\" : "/";
        const fileName = event.filePath.split(sep).pop() ?? "file";

        // Relative path = folder name + everything inside it
        const parentDir = entry.folderPath.slice(0, entry.folderPath.lastIndexOf(sep));

        const rel = event.filePath.startsWith(parentDir + sep)
          ? event.filePath.slice(parentDir.length + 1).replaceAll("\\", "/")
          : fileName;

        // Create a lightweight File shell; actual bytes are read from disk by the sender
        const file = Object.assign(new File([], fileName, { lastModified: Date.now() }), {
          path: event.filePath,
        });

        Object.defineProperty(file, "size", {
          value: event.size,
          configurable: true,
        });

        const qf = createQueuedFile(file, rel, event.watcherId);

        entry.fileMap.set(event.filePath, qf.id);

        await this.locks.lock(qf.id, event.filePath);
        cb.onAdd(event.watcherId, qf);
        break;
      }

      case "unlink": {
        const fileId = entry.fileMap.get(event.filePath);
        if (!fileId) return;

        entry.fileMap.delete(event.filePath);

        // Lock is released by the coordinator's removeWatchedFile path
        cb.onRemove(fileId);
        break;
      }
    }
  }
}

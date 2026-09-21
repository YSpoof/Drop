import { events, filesystem } from "@neutralinojs/lib";

import { readEntries, separatorOf, tryStats } from "#lib/adapters/native/neutralinoFs.js";
import type { WatcherEvent } from "#lib/ports/watcher.js";

type WatchFileDetail = {
  id: number;
  action: string;
  dir: string;
  filename: string;
};

const SETTLE_INTERVAL_MS = 100;
const SETTLE_ATTEMPTS = 50;

/** Our watcher id → every Neutralino watcher created for that folder tree. */
const registrations = new Map<string, Set<number>>();
/** Neutralino watcher id → our watcher id, for routing incoming events. */
const owners = new Map<number, string>();

const listeners = new Set<(event: WatcherEvent) => void>();
let bound = false;

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Waits until the file size stops growing, so half-written files are not queued. */
async function settledSize(filePath: string): Promise<number | null> {
  let previous = -1;
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
    const stats = await tryStats(filePath);
    if (!stats || stats.isDirectory) return null;
    if (stats.size === previous) return stats.size;
    previous = stats.size;
    await sleep(SETTLE_INTERVAL_MS);
  }
  return previous >= 0 ? previous : null;
}

function emit(event: WatcherEvent) {
  for (const listener of listeners) listener(event);
}

/** Registers a watcher for `dir` and every subdirectory below it. */
async function watchTree(watcherId: string, dir: string, ids: Set<number>) {
  const id = await filesystem.createWatcher(dir);
  ids.add(id);
  owners.set(id, watcherId);

  for (const entry of await readEntries(dir)) {
    if (entry.type === "DIRECTORY") await watchTree(watcherId, entry.path, ids);
  }
}

/** Queues files that already exist below a freshly created directory. */
async function emitExisting(watcherId: string, dir: string) {
  for (const entry of await readEntries(dir)) {
    if (entry.type === "DIRECTORY") {
      await emitExisting(watcherId, entry.path);
      continue;
    }
    const size = await settledSize(entry.path);
    if (size !== null) emit({ type: "add", watcherId, filePath: entry.path, size });
  }
}

async function handleWatchFile(detail: WatchFileDetail) {
  const watcherId = owners.get(detail.id);
  if (!watcherId || detail.filename.startsWith(".")) return;

  const filePath = `${detail.dir}${separatorOf(detail.dir)}${detail.filename}`;
  const action = detail.action.toLowerCase();

  switch (action) {
    case "add": {
      const stats = await tryStats(filePath);
      if (stats?.isDirectory) {
        const ids = registrations.get(watcherId);
        if (!ids) return;
        await watchTree(watcherId, filePath, ids);
        await emitExisting(watcherId, filePath);
        return;
      }

      const size = await settledSize(filePath);
      if (size !== null) emit({ type: "add", watcherId, filePath, size });
      return;
    }

    case "delete": {
      emit({ type: "unlink", watcherId, filePath });
      return;
    }
  }
}

export async function watchFolder(watcherId: string, folderPath: string): Promise<void> {
  if (registrations.has(watcherId)) return;
  const ids = new Set<number>();
  registrations.set(watcherId, ids);
  await watchTree(watcherId, folderPath, ids);
}

export async function unwatchFolder(watcherId: string): Promise<void> {
  const ids = registrations.get(watcherId);
  if (!ids) return;
  registrations.delete(watcherId);

  for (const id of ids) {
    owners.delete(id);
    await filesystem.removeWatcher(id).catch(() => undefined);
  }
}

export function onFolderWatchEvent(listener: (event: WatcherEvent) => void): () => void {
  if (!bound) {
    bound = true;
    void events.on("watchFile", (ev) => void handleWatchFile(ev.detail as WatchFileDetail));
  }

  listeners.add(listener);
  return () => listeners.delete(listener);
}

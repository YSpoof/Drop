import { callRpc, onBridgeNotification } from "#lib/adapters/native/goNativeClient.js";
import type { WatcherEvent } from "#lib/ports/watcher.js";

export function watchFolder(watcherId: string, folderPath: string): Promise<void> {
  return callRpc("watch.start", { watcherId, folderPath });
}

export function unwatchFolder(watcherId: string): Promise<void> {
  return callRpc("watch.stop", { watcherId });
}

export function onFolderWatchEvent(listener: (event: WatcherEvent) => void): () => void {
  return onBridgeNotification("watch.event", (data) => {
    listener(data as WatcherEvent);
  });
}

import { desktopApi } from "#lib/adapters/desktop/desktopApi.js";
import { onBridgeNotification } from "#lib/adapters/desktop/desktopClient.js";
import { WatcherPort, type WatcherEvent } from "#lib/ports/watcher.js";

export class DesktopWatcher extends WatcherPort {
  watch(watcherId: string, folderPath: string): Promise<void> {
    return desktopApi.watchFolder(watcherId, folderPath);
  }

  unwatch(watcherId: string): Promise<void> {
    return desktopApi.unwatchFolder(watcherId);
  }

  onEvent(listener: (event: WatcherEvent) => void): () => void {
    return onBridgeNotification("watch.event", (data) => listener(data as WatcherEvent));
  }
}

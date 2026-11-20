import { inject } from "quick-di";

import { onFolderWatchEvent } from "#lib/adapters/desktop/desktopWatch.js";
import { DesktopApi } from "#lib/ports/desktopApi.js";
import { WatcherPort, type WatcherEvent } from "#lib/ports/watcher.js";

export class DesktopWatcher extends WatcherPort {
  private readonly api = inject(DesktopApi);

  watch(watcherId: string, folderPath: string): Promise<void> {
    return this.api.watchFolder(watcherId, folderPath);
  }

  unwatch(watcherId: string): Promise<void> {
    return this.api.unwatchFolder(watcherId);
  }

  onEvent(listener: (event: WatcherEvent) => void): () => void {
    return onFolderWatchEvent(listener);
  }
}

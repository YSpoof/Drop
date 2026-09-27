import { inject } from "quick-di";

import { onFolderWatchEvent } from "#lib/adapters/native/neutralinoWatch.js";
import { NativeApi } from "#lib/ports/nativeApi.js";
import { WatcherPort, type WatcherEvent } from "#lib/ports/watcher.js";

export class NativeWatcher extends WatcherPort {
  private readonly api = inject(NativeApi);

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

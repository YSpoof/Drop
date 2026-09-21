import { onFolderWatchEvent } from "#lib/adapters/native/neutralinoWatch.js";
import type { NativeApi } from "#lib/ports/nativeApi.js";
import type { WatcherEvent, WatcherPort } from "#lib/ports/watcher.js";

export class NativeWatcher implements WatcherPort {
  constructor(private readonly api: NativeApi) {}

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

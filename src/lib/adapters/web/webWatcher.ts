import type { WatcherPort } from "#lib/ports/watcher.js";

/** No-op: web platform doesn't watch folders. */
export class WebWatcher implements WatcherPort {
  async watch(): Promise<void> {}
  async unwatch(): Promise<void> {}
  onEvent(): () => void {
    return () => {};
  }
}

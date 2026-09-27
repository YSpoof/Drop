export type WatcherEvent =
  | { type: "add"; watcherId: string; filePath: string; size: number }
  | { type: "unlink"; watcherId: string; filePath: string };

export abstract class WatcherPort {
  abstract watch(watcherId: string, folderPath: string): Promise<void>;
  abstract unwatch(watcherId: string): Promise<void>;
  abstract onEvent(listener: (event: WatcherEvent) => void): () => void;
}

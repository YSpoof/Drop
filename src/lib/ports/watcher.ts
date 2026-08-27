export type WatcherEvent =
  | { type: "add"; watcherId: string; filePath: string; size: number }
  | { type: "unlink"; watcherId: string; filePath: string };

export type WatcherPort = {
  watch(watcherId: string, folderPath: string): Promise<void>;
  unwatch(watcherId: string): Promise<void>;
  onEvent(listener: (event: WatcherEvent) => void): () => void;
};

// TODO: Better organize this file

export type NativeApi = {
  getDownloadsPath(): Promise<string>;
  pickFolder(defaultPath?: string): Promise<string | null>;
  watchFolder(watcherId: string, folderPath: string): Promise<void>;
  unwatchFolder(watcherId: string): Promise<void>;
  lockFile(filePath: string): Promise<void>;
  unlockFile(filePath: string): Promise<void>;
  pathExists(path: string): Promise<boolean>;
  joinPath(dir: string, ...parts: string[]): Promise<string>;
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  fileSize(path: string): Promise<number | null>;
  listDir(dir: string): Promise<string[]>;
  ensureDir(path: string): Promise<void>;
  openWriteStream(path: string, start?: number): Promise<string>;
  writeStreamChunk(id: string, data: ArrayBuffer): Promise<void>;
  closeWriteStream(id: string): Promise<void>;
  abortWriteStream(id: string): Promise<void>;
  readFileChunk(filePath: string, start: number, length: number): Promise<ArrayBuffer>;
};

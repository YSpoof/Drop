export abstract class NativeApi {
  abstract getDownloadsPath(): Promise<string>;
  abstract pickFolder(defaultPath?: string): Promise<string | null>;
  abstract watchFolder(watcherId: string, folderPath: string): Promise<void>;
  abstract unwatchFolder(watcherId: string): Promise<void>;
  abstract pathExists(path: string): Promise<boolean>;
  abstract joinPath(dir: string, ...parts: string[]): Promise<string>;
  abstract move(from: string, to: string): Promise<void>;
  abstract remove(path: string): Promise<void>;
  abstract fileSize(path: string): Promise<number | null>;
  abstract listDir(dir: string): Promise<string[]>;
  abstract ensureDir(path: string): Promise<void>;
  abstract openWriteStream(path: string, start?: number): Promise<string>;
  abstract writeStreamChunk(id: string, data: ArrayBuffer): Promise<void>;
  abstract closeWriteStream(id: string): Promise<void>;
  abstract abortWriteStream(id: string): Promise<void>;
  abstract readFileChunk(filePath: string, start: number, length: number): Promise<ArrayBuffer>;
}

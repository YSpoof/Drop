export abstract class FileReaderPort {
  abstract readChunk(
    file: File,
    start: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer | undefined>;
}

/** Absolute disk path stamped on a File by the desktop picker or folder watcher; "" otherwise. */
export function filePath(file: File): string {
  return (file as File & { path?: string }).path ?? "";
}

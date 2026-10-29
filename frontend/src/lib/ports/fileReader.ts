export abstract class FileReaderPort {
  abstract readChunk(
    file: File,
    start: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer | undefined>;
  /** Returns absolute disk path for a native File, or empty string in web. */
  abstract nativePath(file: File): string;
}

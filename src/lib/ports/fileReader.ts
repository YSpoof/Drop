export type FileReaderPort = {
  readChunk(file: File, start: number, length: number): Promise<ArrayBuffer | undefined>;
  /** Returns absolute disk path for a native File, or empty string in web. */
  nativePath(file: File): string;
};

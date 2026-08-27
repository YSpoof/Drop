import type { FileReaderPort } from "#lib/ports/fileReader.js";

/** Web: no native file reading; returns undefined so the caller falls back to Blob.slice(). */
export class WebFileReader implements FileReaderPort {
  async readChunk(): Promise<undefined> {
    return undefined;
  }

  nativePath(): string {
    return "";
  }
}

import { inject } from "quick-di";

import { FileReaderPort } from "#lib/ports/fileReader.js";
import { NativeApi } from "#lib/ports/nativeApi.js";

/** Absolute disk path stamped on the File by the native picker or the folder watcher. */
function nativeFilePath(file: File): string {
  return (file as File & { path?: string }).path ?? "";
}

export class NativeFileReader extends FileReaderPort {
  private readonly api = inject(NativeApi);

  async readChunk(file: File, start: number, length: number): Promise<ArrayBuffer | undefined> {
    const path = nativeFilePath(file);
    if (!path) return undefined;
    return this.api.readFileChunk(path, start, length);
  }

  nativePath(file: File): string {
    return nativeFilePath(file);
  }
}

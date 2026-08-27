import { nativeFilePath } from "#lib/adapters/native/ipcBridge.js";
import type { FileReaderPort } from "#lib/ports/fileReader.js";
import type { NativeApi } from "#native";

export class NativeFileReader implements FileReaderPort {
  constructor(private readonly api: NativeApi) {}

  async readChunk(file: File, start: number, length: number): Promise<ArrayBuffer | undefined> {
    const path = nativeFilePath(file);
    if (!path) return undefined;
    return this.api.readFileChunk(path, start, length);
  }

  nativePath(file: File): string {
    return nativeFilePath(file);
  }
}

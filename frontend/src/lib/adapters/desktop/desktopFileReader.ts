import { desktopApi } from "#lib/adapters/desktop/desktopApi.js";
import { FileReaderPort, filePath } from "#lib/ports/fileReader.js";

export class DesktopFileReader extends FileReaderPort {
  async readChunk(
    file: File,
    start: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer | undefined> {
    const path = filePath(file);
    if (!path) return undefined;
    return desktopApi.readFileChunk(path, start, length, signal);
  }
}

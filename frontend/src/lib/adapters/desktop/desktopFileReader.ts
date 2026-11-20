import { inject } from "quick-di";

import { DesktopApi } from "#lib/ports/desktopApi.js";
import { FileReaderPort } from "#lib/ports/fileReader.js";

/** Absolute disk path stamped on the File by the desktop picker or the folder watcher. */
function desktopFilePath(file: File): string {
  return (file as File & { path?: string }).path ?? "";
}

export class DesktopFileReader extends FileReaderPort {
  private readonly api = inject(DesktopApi);

  async readChunk(
    file: File,
    start: number,
    length: number,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer | undefined> {
    const path = desktopFilePath(file);
    if (!path) return undefined;
    return this.api.readFileChunk(path, start, length, signal);
  }

  desktopPath(file: File): string {
    return desktopFilePath(file);
  }
}

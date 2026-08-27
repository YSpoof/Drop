import type { FileAdapterPort } from "#lib/ports/fileAdapter.js";
import type { CreateDownloadStreamOptions } from "#lib/utils/files/transferTypes.js";

export class DownloadService {
  constructor(private readonly files: FileAdapterPort) {}

  createWritableStream(filename: string, opts: CreateDownloadStreamOptions = {}) {
    return this.files.createWritableStream(filename, opts);
  }

  async createWriter(filename: string, opts: CreateDownloadStreamOptions = {}) {
    const stream = await this.createWritableStream(filename, opts);
    return stream.getWriter();
  }

  async downloadFile(source: Blob | File, filename: string): Promise<void> {
    if (typeof window === "undefined") return;
    const writable = await this.createWritableStream(filename, {
      size: source.size,
      mime: source.type || "application/octet-stream",
    });
    await source.stream().pipeTo(writable);
  }

  abortAll(): void {
    this.files.abortAll();
  }

  getResumeOffset(hash: string, size: number): Promise<number> {
    return this.files.getResumeOffset?.(hash, size) ?? Promise.resolve(0);
  }

  dropIncomplete(hash?: string): Promise<void> {
    return this.files.dropIncomplete?.(hash) ?? Promise.resolve();
  }

  ensureReady(timeoutMs?: number): Promise<boolean> {
    return this.files.ensureReady(timeoutMs);
  }
}

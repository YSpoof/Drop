import type { CreateDownloadStreamOptions } from "#lib/utils/files/transferTypes.js";

export abstract class FileAdapterPort {
  abstract createWritableStream(
    filename: string,
    opts?: CreateDownloadStreamOptions,
  ): Promise<WritableStream<Uint8Array>>;
  abstract abortAll(): void;
  abstract ensureReady(timeoutMs?: number): Promise<boolean>;

  getResumeOffset(_hash: string, _size: number): Promise<number> {
    return Promise.resolve(0);
  }

  dropIncomplete(_hash?: string): Promise<void> {
    return Promise.resolve();
  }
}

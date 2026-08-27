import type { CreateDownloadStreamOptions } from "#lib/utils/files/transferTypes.js";

export type FileAdapterPort = {
  createWritableStream(
    filename: string,
    opts?: CreateDownloadStreamOptions,
  ): Promise<WritableStream<Uint8Array>>;
  abortAll(): void;
  ensureReady(timeoutMs?: number): Promise<boolean>;
  getResumeOffset?(hash: string, size: number): Promise<number>;
  dropIncomplete?(hash?: string): Promise<void>;
};

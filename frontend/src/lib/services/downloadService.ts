import { inject } from "quick-di";

import { EnvironmentPort } from "#lib/ports/environment.js";
import { FileAdapterPort } from "#lib/ports/fileAdapter.js";
import type { Archive, Offer, Sink, Writer } from "#lib/transfer/types.js";
import type { CreateDownloadStreamOptions } from "#lib/utils/files/transferTypes.js";
import { ZipDownloadSession } from "#lib/utils/files/zipDownload.js";

/** Saves received files: the engine's `Sink` on web (service worker, zips) and desktop (disk). */
export class DownloadService implements Sink {
  private readonly files = inject(FileAdapterPort);
  private readonly environment = inject(EnvironmentPort);

  createWritableStream(filename: string, opts: CreateDownloadStreamOptions = {}) {
    return this.files.createWritableStream(filename, opts);
  }

  abortAll(): void {
    this.files.abortAll();
  }

  ensureReady(timeoutMs?: number): Promise<void> {
    return this.files.ensureReady(timeoutMs);
  }

  resumeOffset(offer: Offer): Promise<number> {
    return offer.hash ? this.files.getResumeOffset(offer.hash, offer.size) : Promise.resolve(0);
  }

  /** Deletes the partial file of `offer`, or every partial when omitted. */
  dropIncomplete(offer?: Pick<Offer, "hash">): Promise<void> {
    return this.files.dropIncomplete(offer?.hash);
  }

  async open(offer: Offer, offset: number, onAbort: () => void): Promise<Writer> {
    // Desktop keeps the folder layout; a browser download has no folders.
    const name = this.environment.isDesktop ? offer.name : offer.name.split("/").pop()!;
    const stream = await this.createWritableStream(name || offer.name, {
      size: offer.size,
      mime: offer.mime || "application/octet-stream",
      hash: offer.hash,
      startOffset: offset,
      onAbort,
    });
    return writerOf(stream.getWriter());
  }

  archive(name: string | undefined, onAbort: () => void): Archive | null {
    if (this.environment.isDesktop) return null;
    const zip = new ZipDownloadSession(name, { onAbort });
    return {
      // Aborting an entry never fails the zip; there is no partial file to discard.
      entry: (offer) => zip.openEntry(offer.name, offer.size),
      finalize: () => zip.finalize(),
    };
  }
}

function writerOf(writer: WritableStreamDefaultWriter<Uint8Array>): Writer {
  return {
    write: (bytes) => writer.write(bytes),
    close: () => writer.close(),
    abort: (discard) => writer.abort(discard ? "discard" : undefined),
  };
}

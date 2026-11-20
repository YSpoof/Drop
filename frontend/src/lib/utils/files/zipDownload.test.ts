import { crc32 } from "node:zlib";

import { configure } from "quick-di";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnvironmentPort } from "#lib/ports/environment.js";
import { FileAdapterPort } from "#lib/ports/fileAdapter.js";
import { DownloadService } from "#lib/services/downloadService.js";
import { Engine } from "#lib/transfer/engine.js";
import {
  MemorySink,
  MemorySource,
  RecordingHooks,
  TestLink,
  bytesOf,
  settle,
} from "#lib/transfer/fixtures.js";
import { packFrame } from "#lib/transfer/protocol.js";
import type { Sink } from "#lib/transfer/types.js";

import { ZipDownloadSession } from "./zipDownload";

/** A download sink whose writes wait on `release()`, like a slow disk or a paused browser download. */
function slowSink() {
  const chunks: Uint8Array[] = [];
  const gate = Promise.withResolvers<void>();
  const stream = new WritableStream<Uint8Array>({
    async write(chunk) {
      await gate.promise;
      chunks.push(chunk);
    },
  });
  return {
    stream,
    release: () => gate.resolve(),
    zip: () => new Uint8Array(Buffer.concat(chunks)),
    text: () => new TextDecoder().decode(Buffer.concat(chunks)),
  };
}

/** Lets a few macrotask turns run. */
async function ticks() {
  for (let i = 0; i < 5; i += 1) {
    const tick = Promise.withResolvers<void>();
    setTimeout(tick.resolve);
    await tick.promise;
  }
}

/** True when `promise` is still unsettled after a few macrotasks. */
async function isPending(promise: Promise<unknown>) {
  await ticks();
  const probe = Promise.withResolvers<boolean>();
  promise.then(
    () => probe.resolve(false),
    () => probe.resolve(false),
  );
  setTimeout(() => probe.resolve(true));
  return probe.promise;
}

/**
 * Reads a stored (uncompressed) zip through its end record and central directory. Every
 * entry must point at a matching local header and its data must match the recorded CRC.
 */
function unzip(zip: Uint8Array): Map<string, string> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const end = zip.byteLength - 22;
  expect(view.getUint32(end, true), "end of central directory").toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(at, true), "central directory header").toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const skip = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    expect(view.getUint32(local, true), "local header").toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    expect(crc32(data), `CRC of ${name}`).toBe(crc);
    files.set(name, decoder.decode(data));
    at += 46 + nameLength + skip;
  }
  return files;
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("ZipDownloadSession", () => {
  const createWritableStream = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("window", {});
    createWritableStream.mockReset();
    const downloads = { createWritableStream } as Partial<DownloadService> as DownloadService;
    configure([{ provide: DownloadService, useValue: downloads }]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("writes wait for a slow consumer", async () => {
    const sink = slowSink();
    createWritableStream.mockResolvedValue(sink.stream);
    const zip = new ZipDownloadSession("test.zip");

    const writer = await zip.openEntry("a.txt", 64 * 1024);
    const chunk = new Uint8Array(1024);
    const writes = Array.from({ length: 64 }, () => writer.write(chunk));
    writes.forEach((write) => write.catch(() => undefined));

    expect(await isPending(writes.at(-1)!)).toBe(true);

    sink.release();
    await Promise.all(writes);
    await writer.close();
    await zip.finalize();
    expect(createWritableStream).toHaveBeenCalledOnce();
  });

  it("zips every entry and dedupes names", async () => {
    const sink = slowSink();
    sink.release();
    createWritableStream.mockResolvedValue(sink.stream);
    const zip = new ZipDownloadSession("test.zip");

    for (const [name, body] of [
      ["a.txt", "first-body"],
      ["a.txt", "second-body"],
      ["empty.txt", ""],
    ]) {
      const writer = await zip.openEntry(name!, body!.length);
      if (body) await writer.write(bytes(body));
      await writer.close();
    }
    await zip.finalize();

    expect([...unzip(sink.zip())]).toStrictEqual([
      ["a.txt", "first-body"],
      ["a (1).txt", "second-body"],
      ["empty.txt", ""],
    ]);
  });

  it("a failed createWritableStream rejects the write and the next entry retries", async () => {
    const sink = slowSink();
    sink.release();
    createWritableStream
      .mockRejectedValueOnce(new Error("no disk"))
      .mockResolvedValueOnce(sink.stream);
    const zip = new ZipDownloadSession("test.zip");

    const [first, second] = await Promise.all([
      zip.openEntry("a.txt", 3),
      zip.openEntry("b.txt", 3),
    ]);
    const writes = await Promise.allSettled([
      first.write(bytes("aaa")),
      second.write(bytes("bbb")),
    ]);
    expect(writes).toMatchObject([
      { status: "rejected", reason: new Error("no disk") },
      { status: "rejected", reason: new Error("no disk") },
    ]);

    const writer = await zip.openEntry("c.txt", 3);
    await writer.write(bytes("ccc"));
    await writer.close();
    await zip.finalize();

    expect(createWritableStream).toHaveBeenCalledTimes(2);
    expect([...unzip(sink.zip()).keys()]).toStrictEqual(["c.txt"]);
  });

  it("an entry aborted before any byte is left out; the others are kept", async () => {
    const sink = slowSink();
    sink.release();
    createWritableStream.mockResolvedValue(sink.stream);
    const zip = new ZipDownloadSession("test.zip");

    const a = await zip.openEntry("a.txt", 5);
    await a.write(bytes("alpha"));
    await a.close();
    const skipped = await zip.openEntry("b.txt", 4);
    await skipped.abort();
    const c = await zip.openEntry("c.txt", 5);
    await c.write(bytes("gamma"));
    await c.close();
    await zip.finalize();

    expect([...unzip(sink.zip())]).toStrictEqual([
      ["a.txt", "alpha"],
      ["c.txt", "gamma"],
    ]);
  });

  it("an entry aborted mid-stream ends truncated; later entries and the zip stay valid", async () => {
    const sink = slowSink();
    sink.release();
    createWritableStream.mockResolvedValue(sink.stream);
    const zip = new ZipDownloadSession("test.zip");

    const partial = await zip.openEntry("a.txt", 100);
    await partial.write(bytes("half"));
    await partial.abort();
    await expect(partial.write(bytes("more"))).rejects.toThrow("Zip entry closed");
    const next = await zip.openEntry("b.txt", 4);
    await next.write(bytes("next"));
    await next.close();
    await expect(zip.finalize()).resolves.toBeUndefined();

    expect([...unzip(sink.zip())]).toStrictEqual([
      ["a.txt", "half"],
      ["b.txt", "next"],
    ]);
    expect(createWritableStream).toHaveBeenCalledOnce();
  });

  it("no download starts when every entry was aborted before any byte", async () => {
    const zip = new ZipDownloadSession("test.zip");
    const writer = await zip.openEntry("a.txt", 3);
    await writer.abort();
    await zip.finalize();
    expect(createWritableStream).not.toHaveBeenCalled();
    await expect(zip.openEntry("c.txt", 1)).rejects.toThrow("finalized");
  });

  it("a consumer error rejects finalize and closes the session", async () => {
    const failing = new WritableStream<Uint8Array>({
      write: () => Promise.reject(new Error("disk full")),
    });
    createWritableStream.mockResolvedValue(failing);
    const zip = new ZipDownloadSession("test.zip");

    const writer = await zip.openEntry("a.txt", 3);
    void writer.write(bytes("aaa")).catch(() => undefined);
    await ticks();

    await expect(zip.finalize()).rejects.toThrow("disk full");
  });
});

describe("receiver archive through DownloadService", () => {
  /** A manual receiver whose zips go through the real `DownloadService` into `sink`. */
  function setup() {
    vi.stubGlobal("window", {});
    const target = slowSink();
    target.release();
    const files = { createWritableStream: vi.fn().mockResolvedValue(target.stream) };
    configure([
      { provide: FileAdapterPort, useValue: files as Partial<FileAdapterPort> as FileAdapterPort },
      { provide: EnvironmentPort, useValue: { isDesktop: false, hasDesktopFs: false } },
    ]);
    const downloads = new DownloadService();
    configure([{ provide: DownloadService, useValue: downloads }]);

    const link = new TestLink(4);
    const memory = new MemorySink();
    const sink: Sink = {
      resumeOffset: (offer) => memory.resumeOffset(offer),
      open: (offer, offset, onAbort) => memory.open(offer, offset, onAbort),
      dropIncomplete: (offer) => memory.dropIncomplete(offer),
      archive: (name, onAbort) => downloads.archive(name, onAbort),
    };
    const engine = new Engine({
      link,
      source: new MemorySource(),
      sink,
      hooks: new RecordingHooks(),
      manual: true,
    });
    const peer = async (...messages: Parameters<Engine["onControl"]>[0][]) => {
      for (const message of messages) engine.onControl(message);
      await settle();
    };
    const meta = (fileId: string, size: number) =>
      peer({ type: "meta", fileId, name: `${fileId}.txt`, size, mime: "text/plain" });
    const stream = async (fileId: string, streamId: number, text: string) => {
      await peer({ type: "start", fileId, chunkSize: 4, streamId });
      const data = bytes(text);
      for (let at = 0; at < data.byteLength; at += 4) {
        engine.onFrame(packFrame(streamId, data.slice(at, at + 4)));
        await settle();
      }
    };
    return { target, link, engine, peer, meta, stream };
  }

  afterEach(() => vi.unstubAllGlobals());

  it("failed, dismissed and interrupted files leave the completed ones in a valid zip", async () => {
    const t = setup();
    await t.meta("a", 8);
    await t.meta("b", 8);
    await t.meta("c", 8);
    await t.meta("d", 4);
    await t.meta("e", 4);
    await t.meta("f", 4);
    t.engine.pullBatch(["a", "b", "c", "d", "e", "f"], "batch.zip");

    await t.stream("a", 1, "complete");
    await t.peer({ type: "done", fileId: "a" });
    // b: more bytes than announced, so the size check fails.
    await t.stream("b", 2, "halfextra!!!");
    await t.peer({ type: "done", fileId: "b" });
    // c: dismissed mid-stream; d: dismissed before any byte.
    await t.stream("c", 3, "cccc");
    t.engine.dismiss("c");
    await t.stream("d", 4, "");
    t.engine.dismiss("d");
    // e: replaced by the start of f before any byte.
    await t.stream("e", 5, "");
    await t.stream("f", 6, "last");
    await t.peer({ type: "done", fileId: "f" });
    await settle(20);

    expect(t.link.sent("ack").map((m) => m.fileId)).toStrictEqual(["a", "f"]);
    expect([...unzip(t.target.zip())]).toStrictEqual([
      ["a.txt", "complete"],
      // Entries that had bytes when they stopped end where they stopped.
      ["b.txt", "halfextra!!!"],
      ["c.txt", "cccc"],
      ["f.txt", "last"],
    ]);
  });
});

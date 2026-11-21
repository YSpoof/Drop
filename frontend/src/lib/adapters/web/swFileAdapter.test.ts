import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileTooLargeError } from "#lib/transfer/errors.js";

import { BLOB_FALLBACK_LIMIT, QUEUE_LIMIT, SwFileAdapter } from "./swFileAdapter.js";

const MiB = 1024 * 1024;

function delay(ms: number) {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** True when `promise` is still pending after the message queue had time to drain. */
async function isPending(promise: Promise<unknown>) {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  await delay(30);
  return !done;
}

/** One download as the worker sees it: received chunks and messages, and its reply port. */
type Opened = { port: MessagePort; chunks: ArrayBuffer[]; signals: string[] };

/** A worker that opens every download and records what arrives on its ports. */
function fakeWorker() {
  const opened: Opened[] = [];
  const messages: unknown[] = [];
  const controller = {
    postMessage(message: { type?: string }, transfer: MessagePort[] = []) {
      messages.push(message);
      if (message.type !== "download") return;
      const port = transfer[0]!;
      const entry: Opened = { port, chunks: [], signals: [] };
      port.onmessage = ({ data }) => {
        if (data instanceof ArrayBuffer) entry.chunks.push(data);
        else entry.signals.push(data as string);
        if (data === "end") port.postMessage("end-ack");
      };
      opened.push(entry);
      port.postMessage({ download: `http://local/__download__/${opened.length}` });
    },
  } as unknown as ServiceWorker;
  return { controller, opened, messages };
}

const frames: string[] = [];
const links: { href: string; download: string; click: () => void }[] = [];

function stubPage(serviceWorker: object | undefined) {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", serviceWorker ? { serviceWorker } : {});
  vi.stubGlobal("document", {
    body: { appendChild: (frame: { src: string }) => frames.push(frame.src) },
    createElement: (tag: string) => {
      if (tag === "a") {
        const link = { href: "", download: "", click: vi.fn() };
        links.push(link);
        return link;
      }
      return { hidden: false, src: "", remove: () => undefined };
    },
  });
}

beforeEach(() => {
  frames.length = 0;
  links.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("service worker path", () => {
  it("transfers copies and holds write() while more than 4 MiB is unacknowledged", async () => {
    const sw = fakeWorker();
    stubPage({ controller: sw.controller });
    const writer = (await new SwFileAdapter().createWritableStream("a.bin")).getWriter();

    const chunk = new Uint8Array(MiB).fill(7);
    for (let sent = 0; sent < QUEUE_LIMIT; sent += MiB) await writer.write(chunk);
    expect(chunk.byteLength).toBe(MiB); // the caller's view is not detached

    const blocked = writer.write(chunk);
    expect(await isPending(blocked)).toBe(true);

    const [download] = sw.opened;
    expect(download!.chunks.map((c) => c.byteLength)).toEqual([MiB, MiB, MiB, MiB, MiB]);
    expect(frames).toEqual(["http://local/__download__/1"]);

    download!.port.postMessage({ ack: MiB });
    await blocked;
    await writer.close();
    expect(download!.signals).toEqual(["end"]);
  });

  it("writer.abort() releases a write waiting for room and tells the worker", async () => {
    const sw = fakeWorker();
    stubPage({ controller: sw.controller });
    const writer = (await new SwFileAdapter().createWritableStream("a.bin")).getWriter();

    const write = writer.write(new Uint8Array(QUEUE_LIMIT + 1));
    expect(await isPending(write)).toBe(true);
    await writer.abort();
    await expect(write).rejects.toThrow("Download cancelled");
    await delay(10);
    expect(sw.opened[0]!.signals).toEqual(["abort"]);
  });

  it("abortAll aborts only this page's downloads, over their own ports", async () => {
    const sw = fakeWorker();
    stubPage({ controller: sw.controller });
    const tabA = new SwFileAdapter();
    const tabB = new SwFileAdapter();
    const writerA = (await tabA.createWritableStream("a.bin")).getWriter();
    const writerB = (await tabB.createWritableStream("b.bin")).getWriter();

    tabA.abortAll();
    await expect(writerA.write(new Uint8Array(1))).rejects.toThrow("Download cancelled");
    await writerB.write(new Uint8Array(1));
    await delay(10);

    expect(sw.opened[0]!.signals).toEqual(["abort"]);
    expect(sw.opened[1]!.signals).toEqual([]);
    expect(sw.messages.every((m) => (m as { type: string }).type === "download")).toBe(true);
  });

  it("has no size limit", async () => {
    stubPage({ controller: fakeWorker().controller });
    const size = BLOB_FALLBACK_LIMIT * 4;
    await expect(
      new SwFileAdapter().createWritableStream("big.bin", { size }),
    ).resolves.toBeDefined();
  });

  it("a browser cancel calls onAbort and fails later writes", async () => {
    const sw = fakeWorker();
    stubPage({ controller: sw.controller });
    const onAbort = vi.fn();
    const writer = (
      await new SwFileAdapter().createWritableStream("a.bin", { onAbort })
    ).getWriter();
    await writer.write(new Uint8Array(1));

    sw.opened[0]!.port.postMessage("abort");
    await delay(10);
    expect(onAbort).toHaveBeenCalledOnce();
    await expect(writer.write(new Uint8Array(1))).rejects.toThrow("Download cancelled");
  });
});

describe("without a service worker", () => {
  it("ensureReady times out instead of hanging and downloads fall back to a Blob", async () => {
    const never = Promise.withResolvers<never>().promise;
    stubPage({ controller: null, ready: never, addEventListener() {}, removeEventListener() {} });
    const created: Blob[] = [];
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => (created.push(blob), "blob:local/1"),
      revokeObjectURL: () => undefined,
    });

    const adapter = new SwFileAdapter();
    await adapter.ensureReady(20);

    const writer = (
      await adapter.createWritableStream("c.txt", { mime: "text/plain" })
    ).getWriter();
    await writer.write(new TextEncoder().encode("hello "));
    await writer.write(new TextEncoder().encode("world"));
    await writer.close();

    expect(await created[0]!.text()).toBe("hello world");
    expect(created[0]!.type).toBe("text/plain");
    expect(links).toMatchObject([{ href: "blob:local/1", download: "c.txt" }]);
    expect(links[0]!.click).toHaveBeenCalledOnce();
  });

  it("falls back when the browser has no service worker API", async () => {
    stubPage(undefined);
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
    const adapter = new SwFileAdapter();
    await adapter.ensureReady();

    const writer = (await adapter.createWritableStream("d.bin")).getWriter();
    adapter.abortAll();
    await expect(writer.write(new Uint8Array(1))).rejects.toThrow("Download cancelled");
  });

  describe("size limit", () => {
    beforeEach(() => {
      stubPage(undefined);
      vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
    });

    it("refuses a file above 512 MiB with FileTooLargeError", async () => {
      const opening = new SwFileAdapter().createWritableStream("big.bin", {
        size: BLOB_FALLBACK_LIMIT + 1,
      });
      await expect(opening).rejects.toBeInstanceOf(FileTooLargeError);
      await expect(opening).rejects.toThrow("máx. 512 MiB");
    });

    it("accepts a file of exactly 512 MiB", async () => {
      const opening = new SwFileAdapter().createWritableStream("max.bin", {
        size: BLOB_FALLBACK_LIMIT,
      });
      await expect(opening).resolves.toBeDefined();
    });

    it("fails a write that takes an unsized stream (a zip) past the limit", async () => {
      const writer = (await new SwFileAdapter().createWritableStream("a.zip")).getWriter();
      await writer.write(new Uint8Array(1));
      const huge = { byteLength: BLOB_FALLBACK_LIMIT } as Uint8Array;
      await expect(writer.write(huge)).rejects.toBeInstanceOf(FileTooLargeError);
    });
  });
});

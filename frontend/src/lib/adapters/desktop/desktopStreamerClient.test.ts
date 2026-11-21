import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { readViaStreamer } from "#lib/adapters/desktop/desktopStreamerClient.js";

vi.mock("#lib/adapters/desktop/desktopClient.js", () => ({
  getDesktopSession: () => ({ port: 1, token: "t" }),
}));

const files = new Map<string, Uint8Array>([
  ["/a", Uint8Array.from({ length: 1000 }, (_, i) => i % 251)],
  ["/b", Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) % 253)],
]);

/** Range-aware fake host: answers each request after `release()`, and honors aborts. */
function fakeHost() {
  const waiting: Array<() => void> = [];
  const aborted: string[] = [];
  const fetch = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(input);
    const path = url.searchParams.get("path")!;
    const bytes = files.get(path)!;
    const [first, last] = String(new Headers(init.headers).get("Range"))
      .replace("bytes=", "")
      .split("-")
      .map(Number);
    const gate = Promise.withResolvers<void>();
    waiting.push(gate.resolve);
    init.signal?.addEventListener("abort", () => {
      aborted.push(path);
      gate.reject(new DOMException("Aborted", "AbortError"));
    });
    await gate.promise;
    const body = bytes.slice(first, Math.min(last, bytes.length - 1) + 1);
    return new Response(body, { status: 206 });
  });
  const release = () => {
    for (const open of waiting.splice(0)) open();
  };
  return { fetch, release, aborted };
}

let host: ReturnType<typeof fakeHost>;

beforeEach(() => {
  host = fakeHost();
  vi.stubGlobal("fetch", host.fetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const expected = (path: string, start: number, length: number) =>
  files.get(path)!.slice(start, start + length);

test("two concurrent reads of one path at the same offset both get the right bytes", async () => {
  const first = readViaStreamer("/a", 100, 300);
  const second = readViaStreamer("/a", 100, 300);
  await vi.waitFor(() => expect(host.fetch).toHaveBeenCalledTimes(2));
  host.release();

  const [a, b] = await Promise.all([first, second]);
  expect(new Uint8Array(a)).toEqual(expected("/a", 100, 300));
  expect(new Uint8Array(b)).toEqual(expected("/a", 100, 300));
});

test("a read of another path does not cancel an active read", async () => {
  const active = readViaStreamer("/a", 0, 400);
  await vi.waitFor(() => expect(host.fetch).toHaveBeenCalledTimes(1));
  const other = readViaStreamer("/b", 200, 400);
  await vi.waitFor(() => expect(host.fetch).toHaveBeenCalledTimes(2));
  host.release();

  const [a, b] = await Promise.all([active, other]);
  expect(host.aborted).toEqual([]);
  expect(new Uint8Array(a)).toEqual(expected("/a", 0, 400));
  expect(new Uint8Array(b)).toEqual(expected("/b", 200, 400));
});

test("a short read at the end of the file returns the remaining bytes", async () => {
  const read = readViaStreamer("/a", 900, 400);
  await vi.waitFor(() => expect(host.fetch).toHaveBeenCalledTimes(1));
  host.release();
  expect(new Uint8Array(await read)).toEqual(expected("/a", 900, 100));
});

test("aborting one read leaves a concurrent read of the same path intact", async () => {
  const abort = new AbortController();
  const cancelled = readViaStreamer("/a", 0, 300, abort.signal);
  const kept = readViaStreamer("/a", 0, 300);
  await vi.waitFor(() => expect(host.fetch).toHaveBeenCalledTimes(2));
  abort.abort();
  host.release();

  await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  expect(new Uint8Array(await kept)).toEqual(expected("/a", 0, 300));
});

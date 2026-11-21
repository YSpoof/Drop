import desfetch, { type DesFetchOptions } from "desfetch";

import { getDesktopSession } from "#lib/adapters/desktop/desktopClient.js";

const TOKEN_HEADER = "X-Drop-Token";

type LoopbackOptions<T, E = unknown> = DesFetchOptions<T, E> & {
  targetAddressSpace?: "loopback";
};

export type HttpWrite = {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

const abortError = () => new DOMException("Aborted", "AbortError");

/** Reads one chunk with its own bounded Range request, so concurrent reads never share state. */
export async function readViaStreamer(
  path: string,
  start: number,
  length: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (signal?.aborted) throw abortError();
  if (length <= 0) return new ArrayBuffer(0);
  const session = getDesktopSession();
  const url = new URL(`http://127.0.0.1:${session.port}/read`);
  url.searchParams.set("path", path);

  const options: LoopbackOptions<ArrayBuffer> = {
    headers: {
      [TOKEN_HEADER]: session.token,
      Range: `bytes=${start}-${start + length - 1}`,
    },
    signal,
    targetAddressSpace: "loopback",
    parse: async (response) => {
      if (start > 0 && response.status !== 206) throw new Error("Range not honored");
      return response.arrayBuffer();
    },
  };

  const { data, error } = await desfetch(url, options);
  if (signal?.aborted) throw abortError();
  // 416: the offset is at or past the end of the file.
  if (error?.status === 416) return new ArrayBuffer(0);
  if (error) throw new Error(`File streamer read failed: ${error.message}`);
  return data;
}

export async function openHttpWrite(path: string, start: number): Promise<HttpWrite> {
  const session = getDesktopSession();
  const abort = new AbortController();
  let append = start > 0;
  let opened = false;

  const post = async (chunk: Uint8Array) => {
    if (abort.signal.aborted) throw abortError();
    const url = new URL(`http://127.0.0.1:${session.port}/write`);
    url.searchParams.set("path", path);
    if (append) url.searchParams.set("append", "1");

    const options: LoopbackOptions<void, string> = {
      method: "POST",
      headers: { [TOKEN_HEADER]: session.token },
      body: new Blob([chunk.slice()]),
      signal: abort.signal,
      targetAddressSpace: "loopback",
      parse: async () => undefined,
      parseError: async (response) => response.text(),
    };

    const { error } = await desfetch(url, options);
    if (error) {
      if (abort.signal.aborted) throw abortError();
      throw new Error(error.message);
    }
    append = true;
    opened = true;
  };

  return {
    write(chunk: Uint8Array) {
      return post(chunk);
    },
    async close() {
      if (!opened) await post(new Uint8Array());
    },
    abort() {
      abort.abort();
      return Promise.resolve();
    },
  };
}

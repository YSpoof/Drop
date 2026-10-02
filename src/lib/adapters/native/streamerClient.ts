import { events, extensions } from "@neutralinojs/lib";
import desfetch, { type DesFetchOptions } from "desfetch";

const EXTENSION_ID = "br.com.lzart.drop.streamer";
const TOKEN_HEADER = "X-Drop-Token";
const ACK_DELAY_MS = 300;
const READY_TIMEOUT_MS = 10_000;

type StreamerSession = {
  port: number;
  token: string;
};

type LoopbackOptions<T, E = unknown> = DesFetchOptions<T, E> & {
  targetAddressSpace?: "loopback";
};

type OpenRead = {
  offset: number;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  pending: Uint8Array | null;
  abort: AbortController;
};

export type HttpWrite = {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

let ready: StreamerSession | null = null;
const readyWait = Promise.withResolvers<StreamerSession>();
const openReads = new Map<string, OpenRead>();

export function streamerSession(): StreamerSession | null {
  return ready;
}

function wait(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function noteReady(detail: unknown) {
  if (!detail || typeof detail !== "object") return;
  const record = detail as {
    port?: unknown;
    token?: unknown;
    data?: { port?: unknown; token?: unknown };
  };
  const source = typeof record.port === "number" ? record : record.data;
  if (!source || typeof source.port !== "number") return;
  if (typeof source.token !== "string" || source.token.length === 0) return;
  ready = { port: source.port, token: source.token };
  readyWait.resolve(ready);
  console.log(`streamerReady port=${source.port}`);
}

/** Native file bytes require the sidecar. Missing it is an error, not a slower path. */
export function requireStreamer(): Promise<StreamerSession> {
  if (ready) return Promise.resolve(ready);
  const { promise, resolve, reject } = Promise.withResolvers<StreamerSession>();
  const timer = setTimeout(
    () => reject(new Error("File streamer is not running")),
    READY_TIMEOUT_MS,
  );
  readyWait.promise.then(
    (session) => {
      clearTimeout(timer);
      resolve(session);
    },
    (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    },
  );
  return promise;
}

/** Subscribes to the sidecar and asks again until it answers. Does not block UI startup. */
export async function connectStreamer(): Promise<void> {
  await events.on("streamerReady", (event) => {
    noteReady(event.detail);
  });
  while (!ready) {
    try {
      await extensions.dispatch(EXTENSION_ID, "streamerAck", {});
    } catch {
      // Sidecar is not connected yet.
    }
    if (ready) return;
    await wait(ACK_DELAY_MS);
  }
}

function abortRead(read: OpenRead) {
  read.abort.abort();
  void read.reader.cancel().catch(() => undefined);
}

async function openRead(
  session: StreamerSession,
  path: string,
  start: number,
): Promise<OpenRead | null> {
  const abort = new AbortController();
  const url = new URL(`http://127.0.0.1:${session.port}/read`);
  url.searchParams.set("path", path);
  const options: LoopbackOptions<Response> = {
    headers: {
      [TOKEN_HEADER]: session.token,
      Range: `bytes=${start}-`,
    },
    signal: abort.signal,
    targetAddressSpace: "loopback",
    parse: async (response) => response,
  };
  const { data, error } = await desfetch(url, options);
  if (error || !data.body) {
    abort.abort();
    return null;
  }
  if (start > 0 && data.status === 200) {
    abort.abort();
    await data.body.cancel();
    return null;
  }
  return {
    offset: start,
    reader: data.body.getReader(),
    pending: null,
    abort,
  };
}

async function pull(read: OpenRead, length: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (length === 0) return new ArrayBuffer(0);
  const out = new Uint8Array(length);
  let filled = 0;
  while (filled < length) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!read.pending || read.pending.byteLength === 0) {
      const next = await read.reader.read();
      if (next.done) {
        read.offset += filled;
        return out.buffer.slice(0, filled);
      }
      read.pending = next.value;
    }
    const pending = read.pending;
    const take = Math.min(pending.byteLength, length - filled);
    out.set(pending.subarray(0, take), filled);
    filled += take;
    read.pending = take === pending.byteLength ? null : pending.subarray(take);
  }
  read.offset += filled;
  return out.buffer;
}

/** Raw ranged read. Throws when the sidecar cannot serve the file. */
export async function readViaStreamer(
  path: string,
  start: number,
  length: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const session = await requireStreamer();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  let current = openReads.get(path);
  if (current && current.offset !== start) {
    abortRead(current);
    openReads.delete(path);
    current = undefined;
  }
  if (!current) {
    for (const [otherPath, other] of openReads) {
      if (otherPath === path) continue;
      abortRead(other);
      openReads.delete(otherPath);
    }
    const opened = await openRead(session, path, start);
    if (!opened) throw new Error("File streamer read failed");
    current = opened;
    openReads.set(path, current);
  }

  const active = current;
  const onAbort = () => {
    abortRead(active);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await pull(active, length, signal);
  } catch (error) {
    abortRead(active);
    openReads.delete(path);
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function openHttpWrite(path: string, start: number): Promise<HttpWrite> {
  const session = await requireStreamer();
  const abort = new AbortController();
  // Chrome only streams a request body over HTTP/2. This server is HTTP/1.1, so a
  // ReadableStream POST fails with ERR_ALPN_NEGOTIATION_FAILED. Each chunk is a
  // finished POST with Content-Length instead.
  let append = start > 0;
  let opened = false;

  const post = async (chunk: Uint8Array) => {
    if (abort.signal.aborted) throw new DOMException("Aborted", "AbortError");
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
      if (abort.signal.aborted) throw new DOMException("Aborted", "AbortError");
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

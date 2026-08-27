import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import type { NativeApi } from "#native/api.js";
import type { OpenStream } from "#native/types.js";

const openStreams = new Map<string, OpenStream>();

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function tryStat(filePath: string) {
  try {
    return await stat(filePath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    throw error;
  }
}

function waitForDrain(stream: WriteStream): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const onDrain = () => {
    stream.off("error", onError);
    resolve();
  };
  const onError = (error: Error) => {
    stream.off("drain", onDrain);
    reject(error);
  };
  stream.once("drain", onDrain);
  stream.once("error", onError);
  return promise;
}

function endStream(stream: WriteStream): Promise<void> {
  if (stream.destroyed || stream.closed) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  stream.end((error?: Error | null) => {
    if (error) reject(error);
    else resolve();
  });
  return promise;
}

function waitForOpen(stream: WriteStream): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const onOpen = () => {
    stream.off("error", onError);
    resolve();
  };
  const onError = (error: Error) => {
    stream.off("open", onOpen);
    reject(error);
  };
  stream.once("open", onOpen);
  stream.once("error", onError);
  return promise;
}

export const fileSystemHandlers: Pick<
  NativeApi,
  | "pathExists"
  | "joinPath"
  | "move"
  | "remove"
  | "fileSize"
  | "listDir"
  | "ensureDir"
  | "openWriteStream"
  | "writeStreamChunk"
  | "closeWriteStream"
  | "abortWriteStream"
> = {
  async pathExists(filePath: string) {
    return (await tryStat(filePath)) != null;
  },

  async joinPath(dir: string, ...parts: string[]) {
    return path.join(dir, ...parts);
  },

  async move(from: string, to: string) {
    try {
      await rename(from, to);
    } catch (error) {
      if (!isErrno(error, "EXDEV")) throw error;
      await copyFile(from, to);
      await rm(from);
    }
  },

  async remove(filePath: string) {
    await rm(filePath, { force: true });
  },

  async fileSize(filePath: string) {
    return (await tryStat(filePath))?.size ?? null;
  },

  async listDir(dir: string) {
    try {
      return await readdir(dir);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return [];
      throw error;
    }
  },

  async ensureDir(dirPath: string) {
    await mkdir(dirPath, { recursive: true });
  },

  async openWriteStream(filePath: string, start = 0) {
    const stream = createWriteStream(filePath, start > 0 ? { flags: "r+", start } : undefined);
    await waitForOpen(stream);
    const id = randomUUID();
    openStreams.set(id, { stream, path: filePath });
    return id;
  },

  async writeStreamChunk(id: string, data: ArrayBuffer) {
    const open = openStreams.get(id);
    if (!open) throw new Error(`Unknown write stream: ${id}`);
    const ok = open.stream.write(Buffer.from(data));
    if (!ok) await waitForDrain(open.stream);
  },

  async closeWriteStream(id: string) {
    const open = openStreams.get(id);
    if (!open) throw new Error(`Unknown write stream: ${id}`);
    try {
      await endStream(open.stream);
    } finally {
      openStreams.delete(id);
    }
  },

  async abortWriteStream(id: string) {
    const open = openStreams.get(id);
    if (!open) return;
    openStreams.delete(id);
    try {
      await endStream(open.stream);
    } catch {
      open.stream.destroy();
    }
  },
};

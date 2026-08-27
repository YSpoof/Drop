import type { FileAdapterPort } from "#lib/ports/fileAdapter.js";
import {
  DownloadError,
  type CreateDownloadStreamOptions,
  type DownloadHandle,
} from "#lib/utils/files/transferTypes.js";
import type { NativeApi } from "#native";

const DROP_SUFFIX = ".drop";

function uniqueNameAt(name: string, index: number): string {
  if (index === 0) return name;
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const dir = slash >= 0 ? name.slice(0, slash + 1) : "";
  const leaf = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = leaf.lastIndexOf(".");
  const base = dot > 0 ? leaf.slice(0, dot) : leaf;
  const ext = dot > 0 ? leaf.slice(dot) : "";
  return `${dir}${base} (${index})${ext}`;
}

function toArrayBuffer(chunk: Uint8Array): ArrayBuffer {
  return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;
}

function sanitizeRelativePath(filename: string): string {
  const parts = filename
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) {
    throw new DownloadError("Invalid download path");
  }
  return parts.join("/") || "download";
}

function dropName(id: string): string {
  return `${id.replaceAll(/[<>:"/\\|?*]/g, "_")}${DROP_SUFFIX}`;
}

async function uniqueAvailableName(api: NativeApi, dir: string, name: string): Promise<string> {
  for (let index = 0; ; index += 1) {
    const candidate = uniqueNameAt(name, index);
    if (!(await api.pathExists(await api.joinPath(dir, candidate)))) return candidate;
  }
}

async function ensureParentDir(api: NativeApi, dir: string, relative: string) {
  const slash = Math.max(relative.lastIndexOf("/"), relative.lastIndexOf("\\"));
  if (slash > 0) await api.ensureDir(await api.joinPath(dir, relative.slice(0, slash)));
}

export class NativeFsFileAdapter implements FileAdapterPort {
  #active = new Set<DownloadHandle>();

  constructor(
    private readonly api: NativeApi,
    private readonly getDir: () => Promise<string>,
  ) {}

  async ensureReady(): Promise<boolean> {
    return true;
  }

  abortAll(): void {
    for (const handle of [...this.#active]) handle.abort();
    this.#active.clear();
  }

  async getResumeOffset(hash: string, size: number): Promise<number> {
    if (!hash) return 0;
    const existing = await this.api.fileSize(
      await this.api.joinPath(await this.getDir(), dropName(hash)),
    );
    return existing && existing > 0 && existing < size ? existing : 0;
  }

  async dropIncomplete(hash?: string): Promise<void> {
    const { api, getDir } = this;
    const dir = await getDir();
    if (hash) {
      await api.remove(await api.joinPath(dir, dropName(hash))).catch(() => undefined);
      return;
    }
    this.abortAll();
    for (const name of await api.listDir(dir)) {
      if (name.endsWith(DROP_SUFFIX)) {
        await api.remove(await api.joinPath(dir, name)).catch(() => undefined);
      }
    }
  }

  async createWritableStream(
    filename: string,
    opts: CreateDownloadStreamOptions = {},
  ): Promise<WritableStream<Uint8Array>> {
    const { api, getDir } = this;
    const dir = await getDir();
    const relativePath = sanitizeRelativePath(filename);
    const dropPath = await api.joinPath(dir, dropName(opts.hash ?? crypto.randomUUID()));
    const streamId = await api.openWriteStream(dropPath, opts.startOffset ?? 0);

    let done = false;
    let stream!: WritableStream<Uint8Array>;

    const handle: DownloadHandle = {
      abort: () => {
        void stream.abort().catch(() => undefined);
      },
    };
    const unregister = () => {
      this.#active.delete(handle);
    };

    stream = new WritableStream<Uint8Array>({
      async write(chunk) {
        if (done) throw new DownloadError("Download cancelled");
        await api.writeStreamChunk(streamId, toArrayBuffer(chunk));
      },
      async close() {
        unregister();
        if (done) return;
        done = true;
        try {
          await api.closeWriteStream(streamId);
          await ensureParentDir(api, dir, relativePath);
          await api.move(
            dropPath,
            await api.joinPath(dir, await uniqueAvailableName(api, dir, relativePath)),
          );
        } catch (error) {
          await api.abortWriteStream(streamId).catch(() => undefined);
          throw error;
        }
      },
      async abort(reason) {
        unregister();
        if (done) return;
        done = true;
        await api.abortWriteStream(streamId).catch(() => undefined);
        if (reason === "discard") {
          await api.remove(dropPath).catch(() => undefined);
          return;
        }
        opts.onAbort?.();
      },
    });

    this.#active.add(handle);
    return stream;
  }
}

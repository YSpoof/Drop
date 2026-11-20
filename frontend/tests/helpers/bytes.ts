import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Download, Page } from "@playwright/test";

export const MiB = 1024 * 1024;

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A fresh temp dir; call `remove()` when the test ends. */
export async function tempDir(prefix = "drop-e2e-") {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

/** Writes `size` random bytes to `dir/name` (creating parents) and returns the path and hash. */
export async function randomFile(dir: string, name: string, size: number) {
  const filePath = path.join(dir, name);
  const bytes = randomBytes(size);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  return { path: filePath, name: path.basename(name), sha256: sha256(bytes) };
}

/** Waits for the next download on `page` and returns it once it finished. */
export async function nextDownload(page: Page, timeout = 60_000) {
  const download = await page.waitForEvent("download", { timeout });
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) };
}

/** True once `download` ended without a complete file (cancelled or failed). */
export async function downloadFailed(download: Download) {
  return (await download.failure()) !== null;
}

/** Delays every `Blob.arrayBuffer()` on `page` by `ms`, so a send is slow enough to interrupt. */
export async function slowFileReads(page: Page, ms: number) {
  await page.evaluate((delay) => {
    const read = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function (this: Blob) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, delay);
      await promise;
      return read.call(this);
    };
  }, ms);
}

/** Entries of a stored (uncompressed) zip, such as the ones `client-zip` writes. */
export function readStoredZip(zip: Buffer): Map<string, Buffer> {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("Not a zip file");
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("Bad central directory");
    if (zip.readUInt16LE(at + 10) !== 0) throw new Error("Compressed zip entry");
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const skip = nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    entries.set(name, zip.subarray(data, data + size));
    at += 46 + skip;
  }
  return entries;
}

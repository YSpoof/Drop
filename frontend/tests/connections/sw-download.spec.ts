import { expect, test, type Browser, type Page } from "@playwright/test";

import { enableAutoDownload, gotoApp } from "../helpers/app";
import { MiB, nextDownload, randomFile, sha256, tempDir } from "../helpers/bytes";
import { sha256File, waitForDownloadHash } from "../helpers/download";
import { addFiles } from "../helpers/files";
import { assertConnected, createPeerPages, hostShare, joinWithCode } from "../helpers/peers";

test.describe.configure({ mode: "serial" });

let tmp: Awaited<ReturnType<typeof tempDir>>;
test.beforeEach(async () => {
  tmp = await tempDir();
});
test.afterEach(async () => {
  await tmp.remove();
});

/** A host (sender) and `guest` (receiver, auto-download on) connected by PIN. */
async function connect(browser: Browser, guest: Page): Promise<Page> {
  const [host] = await createPeerPages(browser, 1);
  const { code } = await hostShare(host!);
  await joinWithCode(guest, code);
  await assertConnected(guest);
  await assertConnected(host!);
  return host!;
}

async function guestPage(browser: Browser, serviceWorkers: "allow" | "block") {
  const page = await (await browser.newContext({ serviceWorkers })).newPage();
  await gotoApp(page);
  await enableAutoDownload(page);
  return page;
}

test("a file over 64 MiB streams through the worker without growing page memory", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const guest = await guestPage(browser, "allow");
  await expect.poll(() => guest.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const host = await connect(browser, guest);
  const file = await randomFile(tmp.dir, "huge.bin", 80 * MiB + 321);

  // Live JS heap plus ArrayBuffer backing stores, measured after a full GC.
  const cdp = await guest.context().newCDPSession(guest);
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const usage = await cdp.send("Runtime.getHeapUsage");
    return usage.usedSize + (usage.backingStorageSize ?? 0);
  };
  const baseline = await heap();

  const received = waitForDownloadHash(guest, 180_000);
  await addFiles(host, file.path);
  let done = false;
  void received.finally(() => (done = true));
  let peak = baseline;
  let samples = 0;
  while (!done) {
    peak = Math.max(peak, await heap());
    samples++;
  }

  const download = await received;
  const growth = peak - baseline;
  console.log(
    `heap baseline ${(baseline / MiB).toFixed(1)} MiB, peak ${(peak / MiB).toFixed(1)} MiB, ` +
      `growth ${(growth / MiB).toFixed(1)} MiB over ${samples} samples, file ${(80 * MiB + 321) / MiB} MiB`,
  );
  expect(samples).toBeGreaterThan(5);
  expect(growth).toBeLessThan(32 * MiB);
  expect(download.name).toBe(file.name);
  expect(download.sha256).toBe(await sha256File(file.path));
});

test("without a service worker the file still downloads (Blob fallback)", async ({ browser }) => {
  const guest = await guestPage(browser, "block");
  const host = await connect(browser, guest);
  await expect(guest.getByRole("heading", { name: "Navegador não suportado" })).toHaveCount(0);
  expect(await guest.evaluate(() => navigator.serviceWorker?.controller ?? null)).toBeNull();

  const file = await randomFile(tmp.dir, "fallback.bin", 3 * MiB + 11);
  const received = nextDownload(guest);
  await addFiles(host, file.path);
  const download = await received;
  expect(download.name).toBe(file.name);
  expect(sha256(download.bytes)).toBe(file.sha256);
});

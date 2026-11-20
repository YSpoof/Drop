import { expect, test, type Browser, type Page } from "@playwright/test";

import { gotoApp } from "../helpers/app";
import {
  MiB,
  downloadFailed,
  nextDownload,
  randomFile,
  readStoredZip,
  sha256,
  slowFileReads,
  tempDir,
} from "../helpers/bytes";
import { addFiles, addFolder } from "../helpers/files";
import { assertConnected, createPeerPages, hostShare, joinWithCode } from "../helpers/peers";
import { sendFileAndExpectReceived } from "../helpers/transfer";

test.describe.configure({ mode: "serial" });

let tmp: Awaited<ReturnType<typeof tempDir>>;
test.beforeEach(async () => {
  tmp = await tempDir();
});
test.afterEach(async () => {
  await tmp.remove();
});

/** A host (sender) and a guest (receiver) connected by PIN; the guest auto-downloads unless `manual`. */
async function connect(browser: Browser, manual = false): Promise<[Page, Page]> {
  const [host] = await createPeerPages(browser, 1);
  const guest = manual ? await newPage(browser) : (await createPeerPages(browser, 1))[0]!;
  const { code } = await hostShare(host!);
  await joinWithCode(guest, code);
  await assertConnected(guest);
  await assertConnected(host!);
  return [host!, guest];
}

async function newPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await gotoApp(page);
  return page;
}

function fileRow(page: Page, name: string) {
  return page.locator("li").filter({ has: page.getByText(name, { exact: true }) });
}

test.describe("transfer bytes", () => {
  test("multi-chunk file arrives intact", async ({ browser }) => {
    const [host, guest] = await connect(browser);
    const file = await randomFile(tmp.dir, "big.bin", 5 * MiB + 123);
    await sendFileAndExpectReceived(host, guest, file.path, file.name);
  });

  test("manual pull with auto-download off", async ({ browser }) => {
    const [host, guest] = await connect(browser, true);
    const file = await randomFile(tmp.dir, "pulled.bin", 2 * MiB + 7);
    let early = false;
    guest.on("download", () => (early = true));

    await addFiles(host, file.path);
    const pull = guest.getByRole("button", { name: `Baixar ${file.name}` });
    await expect(pull).toBeVisible();
    await expect(fileRow(guest, file.name).getByText(/Pronto para receber/)).toBeVisible();
    expect(early).toBe(false);

    const received = nextDownload(guest);
    await pull.click();
    const download = await received;
    expect(download.name).toBe(file.name);
    expect(sha256(download.bytes)).toBe(file.sha256);
    await expect(host.getByText(/1\/1 enviados/)).toBeVisible();
  });

  test("folder send arrives as one zip", async ({ browser }) => {
    const [host, guest] = await connect(browser);
    const root = `${tmp.dir}/drop-folder`;
    const files = [
      await randomFile(root, "a.bin", 300 * 1024),
      await randomFile(root, "sub/b.bin", MiB + 5),
      await randomFile(root, "sub/deep/c.txt", 17),
    ];

    const received = nextDownload(guest);
    await addFolder(host, root);
    const download = await received;

    expect(download.name).toBe("drop-folder.zip");
    const entries = readStoredZip(download.bytes);
    const hashes = Object.fromEntries([...entries].map(([name, bytes]) => [name, sha256(bytes)]));
    expect(hashes).toEqual({
      "drop-folder/a.bin": files[0]!.sha256,
      "drop-folder/sub/b.bin": files[1]!.sha256,
      "drop-folder/sub/deep/c.txt": files[2]!.sha256,
    });
    await expect(guest.getByText(/3\/3 recebidos/)).toBeVisible();
  });

  test("sender cancels mid-transfer", async ({ browser }) => {
    const [host, guest] = await connect(browser);
    const file = await randomFile(tmp.dir, "cancelled.bin", 8 * MiB);
    await slowFileReads(host, 150);

    const started = guest.waitForEvent("download");
    await addFiles(host, file.path);
    const download = await started;
    await fileRow(host, file.name)
      .getByRole("button", { name: `Remover ${file.name}` })
      .click();

    expect(await downloadFailed(download)).toBe(true);
    await expect(fileRow(host, file.name)).toHaveCount(0);
    await expect(fileRow(guest, file.name)).toHaveCount(0);
  });

  test("receiver removes the file mid-download", async ({ browser }) => {
    const [host, guest] = await connect(browser);
    const file = await randomFile(tmp.dir, "removed.bin", 8 * MiB);
    await slowFileReads(host, 150);

    const started = guest.waitForEvent("download");
    await addFiles(host, file.path);
    const download = await started;
    await fileRow(guest, file.name)
      .getByRole("button", { name: `Remover ${file.name}` })
      .click();

    expect(await downloadFailed(download)).toBe(true);
    await expect(fileRow(guest, file.name)).toHaveCount(0);
    // download-aborted: the sender keeps the file, reset to pending.
    await expect(fileRow(host, file.name).getByText(/Pronto para enviar/)).toBeVisible();
    await expect(host.getByText(/0\/1 enviados/)).toBeVisible();
  });

  test("receiver reloads mid-download and gets the whole file", async ({ browser }) => {
    const [host, guest] = await connect(browser);
    const file = await randomFile(tmp.dir, "reloaded.bin", 8 * MiB);
    await slowFileReads(host, 100);

    const started = guest.waitForEvent("download");
    await addFiles(host, file.path);
    const partial = await started;
    await guest.reload();
    expect(await downloadFailed(partial)).toBe(true);

    const received = nextDownload(guest, 90_000);
    await assertConnected(guest);
    const download = await received;
    expect(download.name).toBe(file.name);
    expect(sha256(download.bytes)).toBe(file.sha256);
  });
});

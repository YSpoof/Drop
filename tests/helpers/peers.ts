import { expect, type Browser, type Page } from "@playwright/test";

import { enableAutoDownload, gotoApp, openRemoteShare } from "./app";

function deviceListSection(page: Page) {
  return page.locator("section.card").filter({
    has: page.getByRole("heading", { name: /Dispositivos disponíveis|Pronto para transferir/ }),
  });
}

export async function getOwnDisplayName(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const readName = (db: IDBDatabase) =>
      new Promise<string | undefined>((resolve) => {
        const tx = db.transaction("keyvaluepairs", "readonly");
        const req = tx.objectStore("keyvaluepairs").get("displayName");
        req.onsuccess = () => resolve(req.result as string | undefined);
        req.onerror = () => resolve(undefined);
      });

    for (const dbName of ["drop", "localforage"]) {
      const db = await new Promise<IDBDatabase | undefined>((resolve) => {
        const req = indexedDB.open(dbName);
        req.onerror = () => resolve(undefined);
        req.onsuccess = () => resolve(req.result);
      });
      if (!db) continue;
      const name = await readName(db);
      if (name) return name;
    }

    throw new Error("Could not read displayName from IndexedDB");
  });
}

export async function createPeerPages(browser: Browser, count: number): Promise<Page[]> {
  const pages: Page[] = [];

  for (let i = 0; i < count; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await gotoApp(page);
    await enableAutoDownload(page);
    pages.push(page);
  }

  return pages;
}

export async function waitForPeer(page: Page, displayName?: string, timeout = 30_000) {
  const peerCard = displayName
    ? deviceListSection(page)
        .locator(".card")
        .filter({ has: page.getByRole("heading", { name: displayName, level: 3 }) })
    : deviceListSection(page)
        .locator(".card")
        .filter({
          has: page.getByRole("button", { name: "Conectar" }),
        });

  await expect(peerCard.first()).toBeVisible({ timeout });
  return peerCard.first().getByRole("button", { name: "Conectar" });
}

export async function connectLocal(initiator: Page, acceptor: Page) {
  const acceptorName = await getOwnDisplayName(acceptor);
  const connectButton = await waitForPeer(initiator, acceptorName);
  await connectButton.click();

  await expect(
    acceptor.getByRole("heading", { name: "Solicitação de conexão", level: 1 }),
  ).toBeVisible();
  await acceptor.getByRole("button", { name: "Aceitar" }).click();

  await assertConnected(initiator);
  await assertConnected(acceptor);
}

export async function assertConnected(page: Page, timeout = 60_000) {
  await expect(page.getByRole("heading", { name: "Pronto para transferir" })).toBeVisible({
    timeout,
  });
  await expect(page.getByRole("button", { name: "Desconectar" })).toBeVisible({ timeout });
}

async function waitForRemoteHostReady(host: Page) {
  await expect(host).toHaveURL(/[?&]room=/);
  await expect(host).toHaveURL(/[?&]host=/);
  await expect(deviceListSection(host)).toBeVisible({ timeout: 15_000 });
}

export async function setupRemoteRoom(host: Page, mode: "manual" | "auto"): Promise<string> {
  await openRemoteShare(host);

  if (mode === "manual") {
    await host.getByRole("heading", { name: "Modo manual", level: 3 }).click();
    await host.waitForURL(/\?.*room=/);
    await host.waitForURL(/\?.*host=/);
    expect(host.url()).not.toContain("auto=");
  } else {
    await host.getByRole("heading", { name: "Modo automático", level: 3 }).click();
    await host.waitForURL(/\?.*room=/);
    await host.waitForURL(/\?.*host=/);
    await host.waitForURL(/\?.*auto=/);
  }

  await closeShareModal(host);
  await waitForRemoteHostReady(host);
  return host.url();
}

async function closeShareModal(page: Page) {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" }).catch(() => undefined);
  }
}

export async function joinRemoteRoom(
  guest: Page,
  url: string,
  options: { acceptOnHost?: Page; mode: "manual" | "auto" },
) {
  await guest.goto(url);
  await dismissTutorialOnPage(guest);

  if (options.mode === "manual") {
    if (!options.acceptOnHost) {
      throw new Error("acceptOnHost required for manual remote join");
    }
    const acceptButton = options.acceptOnHost.getByRole("button", { name: "Aceitar" });
    await expect(acceptButton).toBeVisible({ timeout: 60_000 });
    await acceptButton.click();
  }

  await assertConnected(guest);
  if (options.acceptOnHost) {
    await assertConnected(options.acceptOnHost);
  }
}

async function dismissTutorialOnPage(page: Page) {
  const tutorial = page.getByRole("heading", { name: "Tutorial", level: 1 });
  if (await tutorial.isVisible().catch(() => false)) {
    const next = page.getByRole("button", { name: /Próximo|Começar/ });
    for (let i = 0; i < 6; i++) {
      if (!(await tutorial.isVisible())) break;
      await next.click();
    }
  }
}

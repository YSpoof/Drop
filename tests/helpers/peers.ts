import { expect, type Browser, type Page } from "@playwright/test";

import { enableAutoDownload, generateCode, gotoApp } from "./app";

function shareStatusSection(page: Page) {
  return page.locator("section.card").filter({
    has: page.getByRole("heading", {
      name: /Aguardando a conexão|Esperando pelo host|Conectando|Pronto para transferir/,
    }),
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

export async function hostShare(page: Page): Promise<{ code: string; url: string }> {
  await generateCode(page);

  const url = page.url();
  const code = new URL(url).searchParams.get("code");
  if (!code) throw new Error(`Share URL has no code: ${url}`);

  await expect(shareStatusSection(page).getByText(code, { exact: true })).toBeVisible();
  return { code, url };
}

export async function joinWithCode(page: Page, code: string) {
  await page.getByRole("button", { name: "Possuo um código" }).click();
  await page.getByLabel("Código de 6 dígitos").fill(code);
  await page.waitForURL(/\/share\/\?.*\bcode=/);
}

export async function assertConnected(page: Page, timeout = 60_000) {
  await expect(page.getByRole("heading", { name: "Pronto para transferir" })).toBeVisible({
    timeout,
  });
  await expect(page.getByRole("button", { name: "Desconectar" })).toBeVisible({ timeout });
}

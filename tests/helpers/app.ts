import { expect, type Page } from "@playwright/test";

import { grantNotificationAccess } from "./context";

export async function gotoApp(page: Page) {
  await grantNotificationAccess(page.context());
  await page.goto("/");
  await dismissTutorial(page);
}

export async function generateCode(page: Page) {
  await page.getByRole("button", { name: "Gerar um código" }).click();
  await page.waitForURL(/\/share\/\?.*\bcode=\d{6}/);
}

export async function gotoShare(page: Page) {
  await gotoApp(page);
  await generateCode(page);
}

export async function dismissTutorial(page: Page) {
  const tutorial = page.getByRole("heading", { name: "Configuração inicial", level: 1 });
  const next = page.getByRole("button", { name: /Próximo|Começar/ });

  try {
    await tutorial.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    return;
  }

  for (let i = 0; i < 12; i++) {
    if (!(await tutorial.isVisible())) break;
    await next.click({ timeout: 5_000 }).catch(() => undefined);
  }

  await tutorial.waitFor({ state: "hidden", timeout: 5_000 });
}

export async function closeFabMenu(page: Page) {
  const close = page.locator(".fab-close");
  if (await close.isVisible().catch(() => false)) {
    await close.click();
  }
}

export async function openFabMenu(page: Page) {
  const trigger = page.locator(".fab > div[role='button']");
  const firstAction = page.locator(".fab button.btn-circle").first();

  await expect(async () => {
    await trigger.click();
    await firstAction.waitFor({ state: "visible", timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

export async function enableAutoDownload(page: Page) {
  await openFabMenu(page);
  await page.locator(".fab button.btn-circle").nth(1).click();
  const toggle = page.getByRole("checkbox");
  if (!(await toggle.isChecked())) {
    await toggle.check();
  }
  await page.getByRole("dialog").getByRole("button", { name: "Fechar", exact: true }).click();
  await closeFabMenu(page);
}

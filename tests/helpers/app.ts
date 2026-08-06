import type { Page } from "@playwright/test";

import { grantNotificationAccess } from "./context";

export async function gotoApp(page: Page) {
  await grantNotificationAccess(page.context());
  await page.goto("/");
  await dismissTutorial(page);
}

export async function dismissTutorial(page: Page) {
  const tutorial = page.getByRole("heading", { name: "Tutorial", level: 1 });
  const next = page.getByRole("button", { name: /Próximo|Começar/ });

  try {
    await tutorial.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    return;
  }

  for (let i = 0; i < 6; i++) {
    if (!(await tutorial.isVisible())) break;
    await next.click();
  }

  await tutorial.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
}

export async function closeFabMenu(page: Page) {
  const close = page.locator(".fab-close");
  if (await close.isVisible().catch(() => false)) {
    await close.click();
  }
}

export async function openFabMenu(page: Page) {
  await closeFabMenu(page);
  await page.locator(".fab > div[role='button']").click();
}

export async function openRemoteShare(page: Page) {
  await openFabMenu(page);
  await page
    .locator(".fab")
    .locator("button.btn-circle")
    .filter({ has: page.locator("svg") })
    .first()
    .click();

  const notifyModal = page.getByRole("heading", { name: "Notificações necessárias", level: 1 });
  if (await notifyModal.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: "Continuar" }).click();
  }

  await page.getByRole("heading", { name: "Conectar remotamente", level: 1 }).waitFor();
}

export async function enableAutoDownload(page: Page) {
  await openFabMenu(page);
  await page.locator(".fab button.btn-circle").nth(2).click();
  const toggle = page.getByRole("checkbox");
  if (!(await toggle.isChecked())) {
    await toggle.check();
  }
  await page.getByRole("dialog").getByRole("button", { name: "Fechar", exact: true }).click();
  await closeFabMenu(page);
}

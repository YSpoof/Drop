import { expect, test } from "@playwright/test";

import { closeFabMenu, gotoShare, openFabMenu } from "./helpers/app";

test("typing a display name in Settings on /share sends no extra announce", async ({ page }) => {
  const announces: { code?: string }[] = [];
  page.on("websocket", (ws) => {
    ws.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      const message = JSON.parse(payload);
      if (message.type === "announce") announces.push(message);
    });
  });

  await gotoShare(page);
  // The host announces again once its code is assigned; wait for that one to settle.
  await expect.poll(() => announces.some((announce) => announce.code)).toBe(true);
  await page.waitForTimeout(500);
  const before = announces.length;

  await openFabMenu(page);
  await page.locator(".fab button.btn-circle").nth(1).click();
  const nameInput = page.getByRole("dialog").getByPlaceholder("Nome de exibição");
  await nameInput.clear();
  await nameInput.pressSequentially("Nome novo", { delay: 30 });
  await expect(nameInput).toHaveValue("Nome novo");
  await page.getByRole("dialog").getByRole("button", { name: "Fechar", exact: true }).click();
  await closeFabMenu(page);

  await page.waitForTimeout(1_000);
  expect(announces.length).toBe(before);
});

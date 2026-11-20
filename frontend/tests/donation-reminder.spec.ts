import { expect, test } from "@playwright/test";

import { DONATION_REMINDER_INTERVAL } from "../src/lib/consts.ts";
import { generateCode, gotoApp } from "./helpers/app";
import { setStoredValue } from "./helpers/storage";

test("donation reminder waits while the install modal is open", async ({ page }) => {
  await gotoApp(page);
  // The anchor is 0 on a fresh device, so this count makes the reminder due on the next home mount.
  await setStoredValue(page, "visitCount", DONATION_REMINDER_INTERVAL);

  // Leave home and come back without a reload, with the install modal open the whole time.
  await generateCode(page);
  await page.locator(".install-app-btn").click();
  const installHeading = page.getByRole("heading", { name: "Instalar aplicativo" });
  await expect(installHeading).toBeVisible();

  await page.goBack();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("button", { name: "Gerar um código" })).toBeAttached();

  const reminder = page.getByRole("heading", { name: "Gostou do Drop?" });
  await page.waitForTimeout(1_500);
  await expect(reminder).toBeHidden();
  await expect(installHeading).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(installHeading).toBeHidden();
  await expect(reminder).toBeVisible();
});

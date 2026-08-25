import { expect, test } from "@playwright/test";

import { gotoShare } from "./helpers/app";
import { simulateDragOver, simulateFileDrop } from "./helpers/files";

test.describe("drag and drop", () => {
  test.beforeEach(async ({ page }) => {
    await gotoShare(page);
  });

  test("shows drop overlay on dragover", async ({ page }) => {
    await simulateDragOver(page);
    await expect(page.getByText("DROP seus arquivos e pastas aqui")).toBeVisible();
  });

  test("queues a file on drop", async ({ page }) => {
    await simulateFileDrop(page, [{ name: "dropped.txt", content: "dropped content" }]);
    await expect(page.getByText("dropped.txt")).toBeVisible();
  });

  test("queues multiple files on drop", async ({ page }) => {
    await simulateFileDrop(page, [
      { name: "first.txt", content: "first" },
      { name: "second.txt", content: "second" },
    ]);

    await expect(page.getByText("first.txt")).toBeVisible();
    await expect(page.getByText("second.txt")).toBeVisible();
  });
});

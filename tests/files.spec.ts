import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { gotoApp } from "./helpers/app";
import { addFiles, addFolder, fileNameFromPath } from "./helpers/files";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/test-files");
const helloFile = path.join(fixturesDir, "hello.txt");
const sampleFolder = path.join(fixturesDir, "sample-folder");

test.describe("files", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("adds a single file via picker", async ({ page }) => {
    await addFiles(page, helloFile);

    await expect(page.getByText("hello.txt")).toBeVisible();
    await expect(page.getByText("Arraste arquivos e pastas para cá")).not.toBeVisible();
  });

  test("adds a folder via picker", async ({ page }) => {
    await addFolder(page, sampleFolder);

    await expect(page.getByText("sample-folder")).toBeVisible();
    await page.getByText("sample-folder").click();
    await expect(page.getByText("nested.txt")).toBeVisible();
  });

  test("clears the queue", async ({ page }) => {
    await addFiles(page, helloFile);
    await expect(page.getByText("hello.txt")).toBeVisible();

    await page.getByRole("button", { name: "Limpar fila" }).click();
    await expect(page.getByText("hello.txt")).not.toBeVisible();
    await expect(page.getByText("Arraste arquivos e pastas para cá")).toBeVisible();
  });
});

test("empty state file picker shortcut adds file", async ({ page }) => {
  await gotoApp(page);

  await page.locator('input[type="file"][multiple]').setInputFiles(helloFile);

  await expect(page.getByText(fileNameFromPath(helloFile))).toBeVisible();
});

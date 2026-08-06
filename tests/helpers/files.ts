import type { Page } from "@playwright/test";

export async function addFiles(page: Page, paths: string | string[]) {
  await page.locator('input[type="file"][multiple]').setInputFiles(paths);
}

export async function addFolder(page: Page, dirPath: string) {
  await page.locator('input[type="file"][webkitdirectory]').setInputFiles(dirPath);
}

export async function simulateDragOver(page: Page) {
  await page.evaluate(() => {
    const dataTransfer = new DataTransfer();
    const event = new DragEvent("dragover", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    });
    window.dispatchEvent(event);
  });
}

export async function simulateFileDrop(page: Page, files: { name: string; content: string }[]) {
  await page.evaluate((fileSpecs) => {
    const dataTransfer = new DataTransfer();
    for (const spec of fileSpecs) {
      dataTransfer.items.add(new File([spec.content], spec.name, { type: "text/plain" }));
    }
    const event = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer,
    });
    window.dispatchEvent(event);
  }, files);
}

export function fileNameFromPath(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

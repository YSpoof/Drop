import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { Page } from "@playwright/test";

export async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

/**
 * Waits for the next download on `page`, lets Playwright save it, and returns its name and SHA-256.
 * Call it before triggering the transfer so the event is not missed.
 */
export async function waitForDownloadHash(page: Page, timeout = 60_000) {
  const download = await page.waitForEvent("download", { timeout });
  // Resolves once the download finished; throws if it failed or was cancelled.
  const filePath = await download.path();
  return { name: download.suggestedFilename(), sha256: await sha256File(filePath) };
}

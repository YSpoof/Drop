import { expect, type Page } from "@playwright/test";

import { sha256File, waitForDownloadHash } from "./download";
import { addFiles } from "./files";

/** Sends one file and checks the receiver's UI and the downloaded bytes (SHA-256). */
export async function sendFileAndExpectReceived(
  sender: Page,
  receiver: Page,
  filePath: string,
  fileName: string,
) {
  const timeout = 60_000;
  const received = waitForDownloadHash(receiver, timeout);
  await addFiles(sender, filePath);

  await expect(sender.getByText(/1\/1 enviados/)).toBeVisible({ timeout });
  await expect(receiver.getByText(/1\/1 recebidos/)).toBeVisible({ timeout });

  const filesSection = receiver.locator("section.card").filter({
    has: receiver.getByRole("heading", { name: "Arquivos" }),
  });
  await expect(filesSection.getByText(fileName, { exact: true })).toBeVisible({ timeout: 15_000 });

  const download = await received;
  expect(download.name).toBe(fileName);
  expect(download.sha256).toBe(await sha256File(filePath));
}

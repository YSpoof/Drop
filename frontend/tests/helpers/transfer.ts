import { expect, type Page } from "@playwright/test";

import { addFiles } from "./files";

export async function sendFileAndExpectReceived(
  sender: Page,
  receiver: Page,
  filePath: string,
  fileName: string,
) {
  const timeout = 60_000;
  await addFiles(sender, filePath);

  await expect(sender.getByText(/1\/1 enviados/)).toBeVisible({ timeout });
  await expect(receiver.getByText(/1\/1 recebidos/)).toBeVisible({ timeout });

  const filesSection = receiver.locator("section.card").filter({
    has: receiver.getByRole("heading", { name: "Arquivos" }),
  });
  await expect(filesSection.getByText(fileName, { exact: true })).toBeVisible({ timeout: 15_000 });
}

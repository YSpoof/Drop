import { expect, test } from "@playwright/test";

import { gotoShare } from "./helpers/app";

const PUBLIC_IP = "8.8.8.8";

test("announce carries the ipify IPv4 as publicIpv4", async ({ page }) => {
  await page.context().route(/^https:\/\/api\.ipify\.org\//, (route) =>
    route.fulfill({
      body: `${PUBLIC_IP}\n`,
      contentType: "text/plain",
      headers: { "access-control-allow-origin": "*" },
    }),
  );

  const announces: unknown[] = [];
  page.on("websocket", (ws) => {
    ws.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      const message = JSON.parse(payload);
      if (message.type === "announce") announces.push(message);
    });
  });

  await gotoShare(page);

  await expect.poll(() => announces.length).toBeGreaterThan(0);
  for (const announce of announces) {
    expect(announce).toMatchObject({ type: "announce", publicIpv4: PUBLIC_IP });
  }
});

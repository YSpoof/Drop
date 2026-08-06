import type { BrowserContext } from "@playwright/test";

export async function grantNotificationAccess(context: BrowserContext) {
  await context.grantPermissions(["notifications"]);
  await context.addInitScript(() => {
    Object.defineProperty(globalThis.Notification, "permission", {
      configurable: true,
      get: () => "granted",
    });
    globalThis.Notification.requestPermission = async () => "granted";
  });
}

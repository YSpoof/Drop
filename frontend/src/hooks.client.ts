import type { ClientInit } from "@sveltejs/kit/hooks";
import { configure } from "quick-di";

import { startDesktop } from "#lib/adapters/desktop/desktopClient.js";
import { desktopProviders } from "#lib/adapters/desktop/desktopProviders.js";
import { webProviders } from "#lib/adapters/web/webProviders.js";

function dismissBootSplash() {
  document.getElementById("drop-boot-splash")?.remove();
}

export const init: ClientInit = async () => {
  try {
    await startDesktop(2000);
    configure(desktopProviders);
  } catch {
    configure(webProviders);
  } finally {
    dismissBootSplash();
  }
};

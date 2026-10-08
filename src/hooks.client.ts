import type { ClientInit } from "@sveltejs/kit/hooks";
import { configure } from "quick-di";

import { nativeProviders } from "#lib/adapters/native/nativeProviders.js";
import { startNeutralino } from "#lib/adapters/native/neutralinoClient.js";
import { webProviders } from "#lib/adapters/web/webProviders.js";

function dismissBootSplash() {
  document.getElementById("drop-boot-splash")?.remove();
}

export const init: ClientInit = async () => {
  try {
    // Force @neutralinojs/lib to use ws://127.0.0.1 (not page hostname) for framework socket
    window.NL_CINJECTED = true;
    await startNeutralino();
    configure(nativeProviders);
  } catch {
    configure(webProviders);
  } finally {
    dismissBootSplash();
  }
};

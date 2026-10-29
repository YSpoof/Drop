import type { ClientInit } from "@sveltejs/kit/hooks";
import { configure } from "quick-di";

import { startGoNative } from "#lib/adapters/native/goNativeClient.js";
import { nativeProviders } from "#lib/adapters/native/nativeProviders.js";
import { webProviders } from "#lib/adapters/web/webProviders.js";

function dismissBootSplash() {
  document.getElementById("drop-boot-splash")?.remove();
}

export const init: ClientInit = async () => {
  try {
    await startGoNative(2000);
    configure(nativeProviders);
  } catch {
    configure(webProviders);
  } finally {
    dismissBootSplash();
  }
};

import type { ClientInit } from "@sveltejs/kit/hooks";
import { configure } from "quick-di";

import { isNative } from "#lib/adapters/native/isNative.js";
import { nativeProviders } from "#lib/adapters/native/nativeProviders.js";
import { startNeutralino } from "#lib/adapters/native/neutralinoClient.js";
import { webProviders } from "#lib/adapters/web/webProviders.js";

export const init: ClientInit = async () => {
  const native = isNative();
  configure(native ? nativeProviders : webProviders);
  if (native) await startNeutralino();
};

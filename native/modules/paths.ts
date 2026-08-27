import { app } from "electron";

import type { NativeApi } from "#native/api.js";

export const pathHandlers: Pick<NativeApi, "getDownloadsPath"> = {
  async getDownloadsPath() {
    return app.getPath("downloads");
  },
};

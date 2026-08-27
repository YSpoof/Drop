import { dialog } from "electron";

import type { NativeApi } from "../api.js";

export const dialogHandlers: Pick<NativeApi, "pickFolder"> = {
  async pickFolder(defaultPath?: string) {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      defaultPath,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  },
};

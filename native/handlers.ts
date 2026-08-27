import type { NativeApi } from "./api.js";
import { dialogHandlers } from "./modules/dialog.js";
import { fileSystemHandlers } from "./modules/fileSystem.js";
import { pathHandlers } from "./modules/paths.js";

export const apiHandlers: Omit<
  NativeApi,
  "watchFolder" | "unwatchFolder" | "lockFile" | "unlockFile" | "readFileChunk"
> = {
  ...pathHandlers,
  ...dialogHandlers,
  ...fileSystemHandlers,
};

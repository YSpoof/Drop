import { inject } from "quick-di";

import { DownloadService } from "#lib/services/downloadService.js";
import { flushTransferStats } from "#lib/utils/files/transferStats.js";
import { abortActiveSession } from "#lib/utils/webrtc/SessionManager.js";

export function flushStatsOnHide(): void {
  void flushTransferStats();
}

export function abortOnPageClose(): void {
  abortActiveSession();
  inject(DownloadService).abortAll();
  void flushTransferStats();
}

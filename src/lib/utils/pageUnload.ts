import { abortAllDownloadStreams } from "#lib/utils/files/swDownload.js";
import { flushTransferStats } from "#lib/utils/files/transferStats.js";
import { abortActiveSession } from "#lib/utils/webrtc/SessionManager.js";

export function flushStatsOnHide(): void {
  void flushTransferStats();
}

export function abortOnPageClose(): void {
  abortActiveSession();
  abortAllDownloadStreams();
  void flushTransferStats();
}

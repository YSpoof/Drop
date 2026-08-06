import { abortAllDownloadStreams } from "$lib/utils/files/swDownload";
import { flushTransferStats } from "$lib/utils/files/transferStats";
import { abortActiveSession } from "$lib/utils/webrtc/SessionManager";

export function flushStatsOnHide(): void {
  void flushTransferStats();
}

export function abortOnPageClose(): void {
  abortActiveSession();
  abortAllDownloadStreams();
  void flushTransferStats();
}

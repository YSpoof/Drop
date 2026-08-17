import { localForage } from "#lib/utils/localForage.js";

export interface TransferStats {
  uploadBytes: number;
  downloadBytes: number;
  uploadFiles: number;
  downloadFiles: number;
}

const KEY = "transferStats";
const EMPTY: TransferStats = {
  uploadBytes: 0,
  downloadBytes: 0,
  uploadFiles: 0,
  downloadFiles: 0,
};
const SAVE_DEBOUNCE_MS = 2000;

let pendingStats: TransferStats | null = null;
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export async function loadTransferStats(): Promise<TransferStats> {
  const stored = await localForage.getItem<TransferStats>(KEY);
  if (!stored) return { ...EMPTY };
  return {
    uploadBytes: stored.uploadBytes ?? 0,
    downloadBytes: stored.downloadBytes ?? 0,
    uploadFiles: stored.uploadFiles ?? 0,
    downloadFiles: stored.downloadFiles ?? 0,
  };
}

export async function saveTransferStats(stats: TransferStats): Promise<void> {
  await localForage.setItem(KEY, stats);
}

export function scheduleSaveTransferStats(stats: TransferStats): void {
  pendingStats = stats;
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    const toSave = pendingStats;
    pendingStats = null;
    if (toSave) void saveTransferStats(toSave);
  }, SAVE_DEBOUNCE_MS);
}

export async function flushTransferStats(): Promise<void> {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  if (pendingStats) {
    const toSave = pendingStats;
    pendingStats = null;
    await saveTransferStats(toSave);
  }
}

export async function resetTransferStats(): Promise<TransferStats> {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  pendingStats = null;
  const empty = { ...EMPTY };
  await saveTransferStats(empty);
  return empty;
}

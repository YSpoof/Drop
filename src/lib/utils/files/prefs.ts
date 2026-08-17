import { localForage } from "#lib/utils/localForage.js";

const AUTO_DOWNLOAD_KEY = "autoDownload";

export async function loadAutoDownload(): Promise<boolean> {
  const stored = await localForage.getItem<boolean>(AUTO_DOWNLOAD_KEY);
  if (stored === null) return false;
  return stored;
}

export async function saveAutoDownload(value: boolean): Promise<void> {
  localForage.setItem(AUTO_DOWNLOAD_KEY, value);
}

import { localForage } from "#lib/utils/localForage.js";

const AUTO_DOWNLOAD_KEY = "autoDownload";
const RECEIVE_FOLDER_KEY = "receiveFolderPath";

export async function loadAutoDownload(): Promise<boolean> {
  const stored = await localForage.getItem<boolean>(AUTO_DOWNLOAD_KEY);
  if (stored === null) return false;
  return stored;
}

export async function saveAutoDownload(value: boolean): Promise<void> {
  localForage.setItem(AUTO_DOWNLOAD_KEY, value);
}

export async function loadReceiveFolderPath(): Promise<string> {
  const stored = await localForage.getItem<string>(RECEIVE_FOLDER_KEY);
  return stored ?? "";
}

export async function saveReceiveFolderPath(value: string): Promise<void> {
  localForage.setItem(RECEIVE_FOLDER_KEY, value);
}

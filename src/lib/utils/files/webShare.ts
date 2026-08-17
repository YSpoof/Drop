import { localForage } from "#lib/utils/localForage.js";

export const WEB_SHARE_KEY = "drop:web-share-queue";

export type StoredSharedFile = {
  name: string;
  type: string;
  blob: Blob;
};

export type SharedRecord = {
  id: string;
  timestamp: number;
  files: StoredSharedFile[];
};

export async function pushSharedRecord(record: SharedRecord): Promise<void> {
  const existing = (await localForage.getItem<SharedRecord[]>(WEB_SHARE_KEY)) ?? [];
  existing.push(record);
  await localForage.setItem(WEB_SHARE_KEY, existing);
}

export async function consumeSharedRecords(): Promise<SharedRecord[]> {
  const existing = (await localForage.getItem<SharedRecord[]>(WEB_SHARE_KEY)) ?? [];
  if (existing.length) {
    await localForage.removeItem(WEB_SHARE_KEY);
  }
  return existing;
}

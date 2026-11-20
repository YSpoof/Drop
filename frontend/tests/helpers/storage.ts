import type { Page } from "@playwright/test";

/** Writes a value straight into the app's localforage IndexedDB store ("drop"/"keyvaluepairs"). */
export async function setStoredValue(page: Page, key: string, value: unknown) {
  await page.evaluate(
    ([key, value]) => {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const request = indexedDB.open("drop");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("keyvaluepairs", "readwrite");
        tx.objectStore("keyvaluepairs").put(value, key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      return promise;
    },
    [key, value] as const,
  );
}

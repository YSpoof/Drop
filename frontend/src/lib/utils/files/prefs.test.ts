import { beforeEach, describe, expect, it, vi } from "vitest";

import { localForage } from "#lib/utils/localForage.js";

import { saveAutoDownload, saveReceiveFolderPath } from "./prefs";

vi.mock("#lib/utils/localForage.js", () => ({
  localForage: { getItem: vi.fn(), setItem: vi.fn() },
}));

const setItem = vi.mocked(localForage.setItem);

/** True when `promise` is still unsettled after a macrotask. */
async function isPending(promise: Promise<unknown>) {
  const tick = Promise.withResolvers<boolean>();
  setTimeout(() => tick.resolve(true));
  const done = promise.then(
    () => false,
    () => false,
  );
  return Promise.race([done, tick.promise]);
}

describe.each([
  ["saveAutoDownload", () => saveAutoDownload(true), "autoDownload", true],
  ["saveReceiveFolderPath", () => saveReceiveFolderPath("/tmp/in"), "receiveFolderPath", "/tmp/in"],
] as const)("%s", (_name, save, key, value) => {
  beforeEach(() => setItem.mockReset());

  it("resolves only after setItem resolves", async () => {
    const deferred = Promise.withResolvers<unknown>();
    setItem.mockReturnValueOnce(deferred.promise);
    const saved = save();

    expect(setItem).toHaveBeenCalledWith(key, value);
    expect(await isPending(saved)).toBe(true);
    deferred.resolve(value);
    await expect(saved).resolves.toBeUndefined();
  });

  it("rejects when setItem rejects", async () => {
    setItem.mockRejectedValueOnce(new Error("quota"));
    await expect(save()).rejects.toThrow("quota");
  });
});

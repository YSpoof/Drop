import { beforeEach, describe, expect, it, vi } from "vitest";

import { localForage } from "#lib/utils/localForage.js";

import { saveDisplayName } from "./identity";

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

describe("saveDisplayName", () => {
  beforeEach(() => setItem.mockReset());

  it("resolves only after setItem resolves", async () => {
    const deferred = Promise.withResolvers<unknown>();
    setItem.mockReturnValueOnce(deferred.promise);
    const saved = saveDisplayName("Calm Otter");

    expect(setItem).toHaveBeenCalledWith("displayName", "Calm Otter");
    expect(await isPending(saved)).toBe(true);
    deferred.resolve("Calm Otter");
    await expect(saved).resolves.toBeUndefined();
  });

  it("rejects when setItem rejects", async () => {
    setItem.mockRejectedValueOnce(new Error("quota"));
    await expect(saveDisplayName("Calm Otter")).rejects.toThrow("quota");
  });
});

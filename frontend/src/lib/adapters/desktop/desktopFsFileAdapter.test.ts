import { expect, test, vi } from "vitest";

import type { DesktopApi } from "#lib/adapters/desktop/desktopApi.js";
import { moveToFreeName } from "#lib/adapters/desktop/desktopFsFileAdapter.js";

vi.mock("#lib/stores/transferStore.svelte.js", () => ({ transferStore: {} }));

/** Fake bridge over an in-memory disk; every call yields, like a real round trip. Like the
 * host, `move` never replaces an existing target. */
function fakeBridge(disk: Map<string, string>) {
  const tick = () => Promise.resolve();
  const api = {
    joinPath: async (dir: string, ...parts: string[]) => [dir, ...parts].join("/"),
    move: async (from: string, to: string) => {
      await tick();
      if (disk.has(to)) throw new Error("target exists");
      disk.set(to, disk.get(from)!);
      disk.delete(from);
    },
  };
  return api as unknown as DesktopApi;
}

test("skips taken names and moves to the next free one", async () => {
  const disk = new Map([
    ["/dl/a.txt", "old"],
    ["/dl/a (1).txt", "old 1"],
    ["/dl/x.drop", "new"],
  ]);
  const target = await moveToFreeName(fakeBridge(disk), "/dl/x.drop", "/dl", "a.txt");

  expect(target).toBe("/dl/a (2).txt");
  expect(Object.fromEntries(disk)).toEqual({
    "/dl/a.txt": "old",
    "/dl/a (1).txt": "old 1",
    "/dl/a (2).txt": "new",
  });
});

test("concurrent finalizes of one name never overwrite each other", async () => {
  const disk = new Map([
    ["/dl/a.txt", "old"],
    ["/dl/1.drop", "one"],
    ["/dl/2.drop", "two"],
  ]);
  const api = fakeBridge(disk);

  const targets = await Promise.all([
    moveToFreeName(api, "/dl/1.drop", "/dl", "a.txt"),
    moveToFreeName(api, "/dl/2.drop", "/dl", "a.txt"),
  ]);
  expect(targets.toSorted()).toEqual(["/dl/a (1).txt", "/dl/a (2).txt"]);
  expect(disk.get("/dl/a.txt")).toBe("old");
  expect(targets.map((target) => disk.get(target)).toSorted()).toEqual(["one", "two"]);
});

test("other move errors are not retried", async () => {
  const api = fakeBridge(new Map([["/dl/x.drop", "new"]]));
  let calls = 0;
  api.move = async () => {
    calls += 1;
    throw new Error("permission denied");
  };

  await expect(moveToFreeName(api, "/dl/x.drop", "/dl", "a.txt")).rejects.toThrow(
    "permission denied",
  );
  expect(calls).toBe(1);
});

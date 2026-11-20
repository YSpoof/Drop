import { beforeEach, describe, expect, it, vi } from "vitest";

import { transferStore } from "#lib/stores/transferStore.svelte.js";
import { Engine } from "#lib/transfer/engine.js";
import {
  MemorySink,
  MemorySource,
  RecordingHooks,
  bytesOf,
  pairLinks,
  settle,
  type TestLink,
} from "#lib/transfer/fixtures.js";
import type { PeerLink } from "#lib/utils/webrtc/link.js";

import { TransferService } from "./transferService";

// The real store runs without the Svelte compiler: runes become plain values.
vi.hoisted(() => {
  Object.assign(globalThis, {
    $state: (value: unknown) => value,
    $derived: (value: unknown) => value,
  });
});

const reader = vi.hoisted(() => ({
  failing: new Set<string>(),
  readChunk: async (file: File) => {
    if (reader.failing.has(file.name)) throw new Error("Unreadable");
    return undefined;
  },
}));

vi.mock("quick-di", () => ({ inject: () => reader }));
vi.mock("#lib/utils/localForage.js", () => ({
  localForage: { getItem: async () => null, setItem: async () => undefined },
}));
vi.mock("#lib/services/downloadService.js", () => ({ DownloadService: class {} }));
vi.mock("#lib/stores/toast.svelte.js", () => ({ toastStore: { showToast: () => undefined } }));

/** Opens a link from the app (through `TransferService`) to an automatic receiver. */
function connect(service: TransferService) {
  const [toPeer, toApp] = pairLinks(4);
  const sink = new MemorySink();
  const peer = new Engine({
    link: toApp,
    source: new MemorySource(),
    sink,
    hooks: new RecordingHooks(),
    manual: false,
  });
  toPeer.peer = peer;
  const link = Object.assign(toPeer, { attach: (engine: Engine) => (toApp.peer = engine) });
  service.start(link as unknown as PeerLink, () => undefined);
  return { link: toPeer as TestLink, sink };
}

function fileOf(name: string, length: number) {
  return new File([bytesOf(length).buffer as ArrayBuffer], name);
}

function rowOf(id: string) {
  return transferStore.transfers.find((row) => row.id === id && row.direction === "sent");
}

beforeEach(() => {
  transferStore.queue = [];
  transferStore.transfers = [];
  reader.failing.clear();
});

describe("TransferService across a reconnect", () => {
  it("does not send completed or failed files again", async () => {
    const service = new TransferService();
    const [done] = transferStore.createAndQueue([fileOf("done.txt", 10)]);
    const [broken] = transferStore.createAndQueue([fileOf("broken.txt", 6)]);
    reader.failing.add("broken.txt");

    const first = connect(service);
    await settle(10);
    expect(rowOf(done!.id)).toMatchObject({ status: "completed", bytesTransferred: 10 });
    expect(rowOf(broken!.id)?.status).toBe("failed");
    expect(transferStore.queue).toEqual([]);

    // Peer loss, as `cleanupPeerConnection` handles it.
    first.link.close();
    transferStore.resetTransferState();
    const [next] = transferStore.createAndQueue([fileOf("next.txt", 5)]);

    const second = connect(service);
    await settle(10);
    expect(second.link.sent("meta").map((meta) => meta.fileId)).toEqual([next!.id]);
    expect(second.sink.file(done!.id)).toBeUndefined();
    expect(rowOf(done!.id)?.status).toBe("completed");
    expect(rowOf(broken!.id)?.status).toBe("failed");
    expect(rowOf(next!.id)?.status).toBe("completed");
  });
});

describe("transferStore.resetTransferState", () => {
  it("resets only unfinished queued sends and drops received rows", () => {
    const [queued, gone] = transferStore.createAndQueue([
      new File(["a"], "queued.txt"),
      new File(["b"], "gone.txt"),
    ]);
    transferStore.dequeue(gone!.id);
    const sent = { size: 1, direction: "sent" as const };
    transferStore.transfers = [
      { ...sent, id: queued!.id, name: "queued.txt", status: "in-progress", bytesTransferred: 1 },
      { ...sent, id: gone!.id, name: "gone.txt", status: "pending", bytesTransferred: 0 },
      { ...sent, id: "done", name: "done.txt", status: "completed", bytesTransferred: 1 },
      { ...sent, id: "bad", name: "bad.txt", status: "failed", bytesTransferred: 0 },
      {
        ...sent,
        id: "in",
        name: "in.txt",
        direction: "received",
        status: "pending",
        bytesTransferred: 0,
      },
    ];

    transferStore.resetTransferState();

    expect(
      transferStore.transfers.map(({ id, status, bytesTransferred }) => [
        id,
        status,
        bytesTransferred,
      ]),
    ).toEqual([
      [queued!.id, "pending", 0],
      ["done", "completed", 1],
      ["bad", "failed", 0],
    ]);
  });
});

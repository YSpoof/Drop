import { describe, expect, test } from "vitest";

import { Engine } from "./engine";
import {
  MemorySink,
  MemorySource,
  RecordingHooks,
  bytesOf,
  pairLinks,
  settle,
  type TestLink,
} from "./fixtures";
import { FRAME_HEADER, MAX_CHUNK, SEND_WINDOW, chunkSizeFor } from "./protocol";

interface Side {
  source: MemorySource;
  sink: MemorySink;
  hooks: RecordingHooks;
}

function side(): Side {
  return { source: new MemorySource(), sink: new MemorySink(), hooks: new RecordingHooks() };
}

/** Connects `alice` (sender) and `bob` (receiver) over a fresh paired link. */
function connect(alice: Side, bob: Side, { chunkSize = 4, bobManual = false } = {}) {
  const [toBob, toAlice] = pairLinks(chunkSize);
  const a = new Engine({ link: toBob, ...alice, manual: false });
  const b = new Engine({ link: toAlice, ...bob, manual: bobManual });
  toBob.peer = b;
  toAlice.peer = a;
  return { a, b, toBob, toAlice };
}

function fileBytes(link: TestLink) {
  return link.frames.reduce((sum, frame) => sum + frame.byteLength - FRAME_HEADER, 0);
}

describe("engine end to end", () => {
  test("single file", async () => {
    const alice = side();
    const bob = side();
    const data = bytesOf(10);
    alice.source.add("f", data, "hello.txt");
    connect(alice, bob);
    await settle();

    expect([...bob.sink.file("f")!.bytes]).toStrictEqual([...data]);
    expect(bob.sink.file("f")!.state).toBe("closed");
    expect(alice.hooks.finishedOf("f")).toMatchObject({ status: "completed", direction: "sent" });
    expect(bob.hooks.finishedOf("f")).toMatchObject({ status: "completed", name: "hello.txt" });
    expect(alice.hooks.of("batchDone").map((e) => e.info.fileCountInBatch)).toStrictEqual([1]);
    expect(bob.hooks.of("batchDone").map((e) => e.info.fileCountInBatch)).toStrictEqual([1]);
  });

  test("multi-chunk file larger than the window, with real chunk sizes", async () => {
    const alice = side();
    const bob = side();
    const data = bytesOf(SEND_WINDOW + 3 * MAX_CHUNK + 123);
    alice.source.add("big", data);
    const { toBob, toAlice } = connect(alice, bob, { chunkSize: chunkSizeFor(1_073_741_823) });
    await settle(20);

    expect(bob.sink.file("big")!.bytes).toStrictEqual(data);
    expect(alice.hooks.finishedOf("big")?.status).toBe("completed");
    expect(Math.max(...toBob.frames.map((f) => f.byteLength))).toBeLessThanOrEqual(MAX_CHUNK);
    expect(
      toAlice
        .sent("credit")
        .map((c) => c.bytesWritten)
        .at(-1),
    ).toBe(data.byteLength);
  });

  test("resume after the receiver reloads mid-download", async () => {
    const alice = side();
    const bob = side();
    const data = bytesOf(40);
    alice.source.add("f", data);
    const stall = Promise.withResolvers<void>();
    let accepted = 0;
    bob.sink.beforeWrite = async () => {
      if (accepted >= 12) await stall.promise;
      accepted += 4;
    };
    const first = connect(alice, bob);
    await settle();
    first.toBob.close();
    stall.resolve();
    await settle();
    expect(bob.sink.file("f")!.state).toBe("aborted");

    bob.sink.beforeWrite = null;
    const second = connect(alice, bob);
    await settle();

    expect(second.toAlice.sent("resume")[0]?.bytesOffset).toBe(12);
    expect(fileBytes(second.toBob)).toBe(28);
    expect([...bob.sink.file("f")!.bytes]).toStrictEqual([...data]);
    expect(alice.hooks.finishedOf("f")?.status).toBe("completed");
  });

  test("cancel mid-transfer removes the file on both sides and the next file still goes", async () => {
    const alice = side();
    const bob = side();
    alice.source.add("a", bytesOf(40));
    alice.source.add("b", bytesOf(8, 3));
    const stall = Promise.withResolvers<void>();
    bob.sink.beforeWrite = (download) =>
      download.offer.fileId === "a" ? stall.promise : undefined;
    const { a } = connect(alice, bob);
    await settle();

    a.cancel("a");
    stall.resolve();
    await settle();

    expect(alice.hooks.of("removed").map((e) => e.fileId)).toStrictEqual(["a"]);
    expect(bob.hooks.of("removed").map((e) => e.fileId)).toStrictEqual(["a"]);
    expect(bob.sink.file("a")!.state).toBe("discarded");
    expect([...bob.sink.file("b")!.bytes]).toStrictEqual([...bytesOf(8, 3)]);
    expect(alice.hooks.finishedOf("b")?.status).toBe("completed");
  });

  test("a dismissed offer is never sent; a pulled one is", async () => {
    const alice = side();
    const bob = side();
    alice.source.add("x", bytesOf(8));
    alice.source.add("y", bytesOf(8, 2));
    const { b } = connect(alice, bob, { bobManual: true });
    await settle();
    expect(bob.hooks.row("x")?.status).toBe("pending");

    b.dismiss("x");
    b.pull("y");
    await settle();

    expect(alice.hooks.row("x")).toMatchObject({ status: "pending", bytesTransferred: 0 });
    expect(bob.sink.file("x")).toBeUndefined();
    expect([...bob.sink.file("y")!.bytes]).toStrictEqual([...bytesOf(8, 2)]);
    expect(alice.hooks.of("batchDone")).toHaveLength(1);
  });

  test("a manual pull-batch lands in one finalized zip", async () => {
    const alice = side();
    const bob = side();
    alice.source.add("p", bytesOf(6), "dir/p.txt");
    alice.source.add("q", bytesOf(9), "dir/q.txt");
    const { b } = connect(alice, bob, { bobManual: true });
    await settle();
    b.pullBatch(["p", "q"], "dir.zip");
    await settle();

    const [zip] = bob.sink.archives;
    expect(zip?.finalized).toBe(1);
    expect(zip?.entries.map((e) => [e.offer.name, e.bytes.byteLength])).toStrictEqual([
      ["dir/p.txt", 6],
      ["dir/q.txt", 9],
    ]);
    expect(bob.hooks.of("batchDone").map((e) => e.info.fileCountInBatch)).toStrictEqual([2]);
  });

  test("bye reaches the peer", async () => {
    const bob = side();
    const { a } = connect(side(), bob);
    a.bye();
    await settle();
    expect(bob.hooks.of("bye")).toHaveLength(1);
  });
});

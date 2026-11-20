import { afterEach, describe, expect, test, vi } from "vitest";

import { Engine } from "./engine";
import { MemorySink, MemorySource, RecordingHooks, TestLink, bytesOf, settle } from "./fixtures";
import {
  ACK_TIMEOUT,
  MAX_CHUNK,
  RESUME_TIMEOUT,
  SEND_WINDOW,
  chunkSizeFor,
  unpackFrame,
  type ControlMessage,
} from "./protocol";

const MiB = 1024 * 1024;

/** A sender engine whose peer is the test: inbound messages go through `peer()`. */
function setup(chunkSize = 4) {
  const link = new TestLink(chunkSize);
  const source = new MemorySource();
  const hooks = new RecordingHooks();
  const engine = new Engine({ link, source, sink: new MemorySink(), hooks, manual: true });
  const peer = async (...messages: ControlMessage[]) => {
    for (const message of messages) engine.onControl(message);
    await settle();
  };
  const hashOf = (id: string) => source.items.find((item) => item.id === id)!.hash;
  const resume = (fileId: string, bytesOffset = 0) =>
    peer({ type: "resume", fileId, hash: hashOf(fileId), bytesOffset });
  const starts = (fileId?: string) =>
    link.sent("start").filter((start) => !fileId || start.fileId === fileId);
  /** File bytes sent on `streamId`, concatenated. */
  const streamed = (streamId: number) =>
    link.frames
      .map((frame) => unpackFrame(frame)!)
      .filter((frame) => frame.streamId === streamId)
      .flatMap((frame) => [...frame.bytes]);
  return { link, source, hooks, engine, peer, resume, starts, streamed };
}

/** Sends one file to an automatic peer: resume at 0 and ack. */
async function deliver(t: ReturnType<typeof setup>, fileId: string) {
  await t.resume(fileId);
  await t.peer({ type: "ack", fileId });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("stream ID and frames", () => {
  test("every frame is the start's stream ID (u32 BE) followed by at most one chunk", async () => {
    const t = setup(4);
    const data = bytesOf(10);
    t.source.add("a", data);
    await t.peer({ type: "download-mode", manual: false });
    await t.resume("a");

    const [start] = t.starts("a");
    expect(start?.chunkSize).toBe(4);
    expect(t.link.frames).toHaveLength(3);
    for (const frame of t.link.frames) {
      expect(new DataView(frame.buffer).getUint32(0)).toBe(start!.streamId);
      expect(frame.byteLength - 4).toBeLessThanOrEqual(4);
    }
    expect(t.streamed(start!.streamId)).toStrictEqual([...data]);
  });

  test("the same file started twice gets a new stream ID", async () => {
    const t = setup();
    t.source.add("a", bytesOf(8));
    t.engine.queueChanged();
    await t.peer({ type: "pull", fileId: "a" });
    await t.peer({ type: "download-aborted", fileId: "a" }, { type: "pull", fileId: "a" });

    const [first, second] = t.starts("a");
    expect(second).toBeDefined();
    expect(second!.streamId).not.toBe(first!.streamId);
  });
});

describe("timeouts", () => {
  test("no resume: after 30 s the file fails, cancel is sent, the next file starts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = setup();
    t.source.add("a", bytesOf(8));
    t.source.add("b", bytesOf(8));
    await t.peer({ type: "download-mode", manual: false });
    expect(t.starts().map((s) => s.fileId)).toStrictEqual(["a"]);

    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT - 1);
    expect(t.hooks.finishedOf("a")).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await settle();

    expect(t.hooks.finishedOf("a")?.status).toBe("failed");
    expect(t.link.sent("cancel").map((c) => c.fileId)).toStrictEqual(["a"]);
    expect(t.starts().map((s) => s.fileId)).toStrictEqual(["a", "b"]);
  });

  test("no ack: after 15 s the file fails and the next file is sent", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = setup();
    t.source.add("a", bytesOf(8));
    t.source.add("b", bytesOf(8));
    await t.peer({ type: "download-mode", manual: false });
    await t.resume("a");
    expect(t.link.sent("done")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(ACK_TIMEOUT);
    await settle();

    expect(t.hooks.finishedOf("a")?.status).toBe("failed");
    expect(t.link.sent("cancel").map((c) => c.fileId)).toStrictEqual(["a"]);
    expect(t.starts().map((s) => s.fileId)).toStrictEqual(["a", "b"]);
  });

  test("an answered resume clears its timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = setup();
    t.source.add("a", bytesOf(8));
    await t.peer({ type: "download-mode", manual: false });
    await deliver(t, "a");
    await vi.advanceTimersByTimeAsync(RESUME_TIMEOUT + ACK_TIMEOUT);
    expect(t.hooks.finishedOf("a")?.status).toBe("completed");
    expect(t.link.sent("cancel")).toHaveLength(0);
  });
});

describe("read failure", () => {
  test("a failed read cancels only that file and the next one is sent (no stall)", async () => {
    const t = setup();
    t.source.add("a", bytesOf(8));
    t.source.add("b", bytesOf(8));
    t.source.failRead = (item) => {
      if (item.id === "a") throw new Error("File was removed");
    };
    await t.peer({ type: "download-mode", manual: false });
    await t.resume("a");

    expect(t.link.sent("cancel")).toStrictEqual([
      { type: "cancel", fileId: "a", reason: "File was removed" },
    ]);
    expect(t.hooks.finishedOf("a")).toMatchObject({ status: "failed", reason: "File was removed" });
    expect(t.starts().map((s) => s.fileId)).toStrictEqual(["a", "b"]);

    await deliver(t, "b");
    expect(t.hooks.finishedOf("b")?.status).toBe("completed");
  });
});

describe("resume", () => {
  test("re-pull after download-aborted streams from the new resume, not the old one", async () => {
    const t = setup(4);
    const data = bytesOf(16);
    t.source.add("a", data);
    t.engine.queueChanged();
    await t.peer({ type: "pull", fileId: "a" });
    await t.resume("a", 4);
    await t.peer({ type: "download-aborted", fileId: "a" });
    // A late resume for the abandoned start arrives while nothing waits for it.
    await t.resume("a", 4);
    expect(t.starts("a")).toHaveLength(1);

    await t.peer({ type: "pull", fileId: "a" });
    const second = t.starts("a")[1]!;
    await t.resume("a", 12);

    expect(t.streamed(second.streamId)).toStrictEqual([...data.slice(12)]);
    expect(t.hooks.row("a")).toMatchObject({ status: "in-progress", bytesTransferred: 12 });
  });

  test("a resume for another file or a mismatched hash does not move the offset", async () => {
    const t = setup(4);
    const data = bytesOf(8);
    t.source.add("a", data);
    await t.peer({ type: "download-mode", manual: false });
    await t.peer({ type: "resume", fileId: "other", hash: "x", bytesOffset: 4 });
    expect(t.link.frames).toHaveLength(0);
    await t.peer({ type: "resume", fileId: "a", hash: "wrong", bytesOffset: 4 });
    expect(t.streamed(t.starts("a")[0]!.streamId)).toStrictEqual([...data]);
  });

  test("resume at N counts N as confirmed and sends nothing below it", async () => {
    const t = setup(MiB);
    t.source.add("a", new Uint8Array(20 * MiB));
    await t.peer({ type: "download-mode", manual: false });
    await t.resume("a", 4 * MiB);
    expect(t.link.frames).toHaveLength(SEND_WINDOW / MiB);
    expect(t.hooks.row("a")).toMatchObject({ bytesTransferred: 4 * MiB });
  });
});

describe("chunk size", () => {
  test("a huge browser maximum still yields frames of at most 256 KiB and progress", async () => {
    const t = setup(chunkSizeFor(1_073_741_823));
    const data = bytesOf(3 * MAX_CHUNK);
    t.source.add("a", data);
    await t.peer({ type: "download-mode", manual: false });
    await deliver(t, "a");

    expect(t.starts("a")[0]?.chunkSize).toBe(MAX_CHUNK - 4);
    expect(Math.max(...t.link.frames.map((f) => f.byteLength))).toBe(MAX_CHUNK);
    expect(t.link.frames).toHaveLength(4);
    expect(t.streamed(t.starts("a")[0]!.streamId)).toStrictEqual([...data]);
    expect(t.hooks.finishedOf("a")?.status).toBe("completed");
  });

  test("an unknown maximum uses 64 KiB frames", async () => {
    const t = setup(chunkSizeFor(0));
    t.source.add("a", bytesOf(100_000));
    await t.peer({ type: "download-mode", manual: false });
    await t.resume("a");
    expect(t.link.frames.map((f) => f.byteLength)).toStrictEqual([65_536, 100_000 - 65_532 + 4]);
  });
});

describe("window and confirmations", () => {
  test("a slow receiver pauses the sender at 8 MiB unconfirmed", async () => {
    const t = setup(MiB);
    t.source.add("a", new Uint8Array(12 * MiB));
    await t.peer({ type: "download-mode", manual: false });
    await t.resume("a");
    expect(t.link.frames).toHaveLength(8);
    await t.peer({ type: "credit", fileId: "a", bytesWritten: 2 * MiB });
    expect(t.link.frames).toHaveLength(10);
    expect(t.hooks.row("a")).toMatchObject({ status: "in-progress", bytesTransferred: 2 * MiB });
  });

  test("a credit for another file does not move the confirmed offset", async () => {
    const t = setup(MiB);
    t.source.add("a", new Uint8Array(12 * MiB));
    await t.peer({ type: "download-mode", manual: false });
    await t.resume("a");
    await t.peer({ type: "credit", fileId: "other", bytesWritten: 4 * MiB });
    expect(t.link.frames).toHaveLength(8);
  });

  test("cancel ends the window wait and sends no further byte", async () => {
    const t = setup(MiB);
    t.source.add("a", new Uint8Array(12 * MiB));
    t.source.add("b", bytesOf(4));
    await t.peer({ type: "download-mode", manual: false });
    await t.resume("a");
    await t.peer({ type: "cancel", fileId: "a" });
    await t.peer({ type: "credit", fileId: "a", bytesWritten: 8 * MiB });

    const streamA = t.starts("a")[0]!.streamId;
    expect(t.link.frames.filter((f) => unpackFrame(f)?.streamId === streamA)).toHaveLength(8);
    expect(t.hooks.of("removed").map((e) => e.fileId)).toStrictEqual(["a"]);
    expect(t.starts().map((s) => s.fileId)).toStrictEqual(["a", "b"]);
  });

  test("progress stays below the size until the ack, then completes", async () => {
    const t = setup(4);
    t.source.add("a", bytesOf(8));
    await t.peer({ type: "download-mode", manual: false });
    await t.resume("a");
    await t.peer({ type: "credit", fileId: "a", bytesWritten: 8 });
    expect(t.hooks.row("a")?.status).toBe("in-progress");
    expect(t.hooks.finishedOf("a")).toBeUndefined();
    await t.peer({ type: "ack", fileId: "a" });
    expect(t.hooks.finishedOf("a")).toMatchObject({ status: "completed", size: 8 });
  });
});

describe("pulls and aborts", () => {
  test("an ack for another file neither completes the current one nor pops the pull queue", async () => {
    const t = setup(4);
    t.source.add("a", bytesOf(8));
    t.source.add("b", bytesOf(8));
    t.engine.queueChanged();
    await t.peer({ type: "pull-batch", fileIds: ["a", "b"] });
    await t.resume("a");
    await t.peer({ type: "ack", fileId: "b" });

    expect(t.hooks.finishedOf("a")).toBeUndefined();
    expect(t.starts().map((s) => s.fileId)).toStrictEqual(["a"]);
    await t.peer({ type: "ack", fileId: "a" });
    expect(t.starts().map((s) => s.fileId)).toStrictEqual(["a", "b"]);
    await deliver(t, "b");
    expect(t.hooks.finishedOf("b")?.status).toBe("completed");
  });

  test("download-aborted resets the file to pending without removing it", async () => {
    const t = setup(4);
    t.source.add("a", bytesOf(64));
    t.engine.queueChanged();
    await t.peer({ type: "pull", fileId: "a" });
    await t.resume("a");
    await t.peer({ type: "download-aborted", fileId: "a" });
    expect(t.hooks.row("a")).toMatchObject({ status: "pending", bytesTransferred: 0 });
    expect(t.hooks.of("removed")).toHaveLength(0);
    expect(t.link.sent("cancel")).toHaveLength(0);
  });

  test("a dismissed offer is not kept waiting for a pull", async () => {
    const t = setup(4);
    t.source.add("a", bytesOf(8));
    t.source.add("b", bytesOf(8));
    t.engine.queueChanged();
    await t.peer({ type: "download-aborted", fileId: "a" });
    await t.peer({ type: "download-mode", manual: false });

    expect(t.starts().map((s) => s.fileId)).toStrictEqual(["b"]);
    await deliver(t, "b");
    expect(t.starts().map((s) => s.fileId)).toStrictEqual(["b"]);
    expect(t.hooks.row("a")?.status).toBe("pending");
  });

  test("a local cancel mid-transfer tells the peer and stops the file", async () => {
    const t = setup(MiB);
    t.source.add("a", new Uint8Array(12 * MiB));
    await t.peer({ type: "download-mode", manual: false });
    await t.resume("a");
    t.engine.cancel("a");
    await settle();
    await t.peer({ type: "credit", fileId: "a", bytesWritten: 8 * MiB });
    expect(t.link.sent("cancel")).toStrictEqual([{ type: "cancel", fileId: "a" }]);
    expect(t.link.frames).toHaveLength(8);
    expect(t.hooks.of("removed").map((e) => e.fileId)).toStrictEqual(["a"]);
    t.engine.queueChanged();
    expect(t.link.sent("meta")).toHaveLength(1);
  });
});

describe("batch-done", () => {
  test("an idle queue sends no batch-done", async () => {
    const t = setup();
    t.source.add("a", bytesOf(4));
    t.engine.queueChanged();
    await settle();
    t.engine.queueChanged();
    await t.peer({ type: "download-mode", manual: true });
    expect(t.link.sent("meta")).toHaveLength(1);
    expect(t.link.sent("batch-done")).toHaveLength(0);
    expect(t.hooks.of("batchDone")).toHaveLength(0);
  });

  test("a batch of three files sends one batch-done after the third", async () => {
    const t = setup();
    for (const id of ["a", "b", "c"]) t.source.add(id, bytesOf(4));
    await t.peer({ type: "download-mode", manual: false });
    await deliver(t, "a");
    await deliver(t, "b");
    expect(t.link.sent("batch-done")).toHaveLength(0);
    await deliver(t, "c");
    t.engine.queueChanged();
    await settle();

    expect(t.link.sent("batch-done")).toHaveLength(1);
    expect(t.link.controls.at(-1)).toStrictEqual({ type: "batch-done" });
    expect(t.hooks.of("batchDone").map((e) => e.info.fileCountInBatch)).toStrictEqual([3]);
    const batchIds = new Set(t.hooks.of("finished").map((e) => e.entry.batchId));
    expect(batchIds.size).toBe(1);
  });
});

describe("peer loss", () => {
  test("closing the link stops the loop and the current file", async () => {
    const t = setup(MiB);
    t.source.add("a", new Uint8Array(12 * MiB));
    await t.peer({ type: "download-mode", manual: false });
    await t.resume("a");
    t.link.close();
    await t.engine.done;
    expect(t.link.frames).toHaveLength(8);
    expect(t.hooks.of("finished")).toHaveLength(0);
  });
});

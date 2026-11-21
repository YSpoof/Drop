import { afterEach, describe, expect, test, vi } from "vitest";

import { Engine } from "./engine";
import { FileTooLargeError } from "./errors";
import { MemorySink, MemorySource, RecordingHooks, TestLink, bytesOf, settle } from "./fixtures";
import { CREDIT_BATCH, fileIdentity, packFrame, type ControlMessage } from "./protocol";
import { DONE_GRACE } from "./receive";

/** A receiver engine whose peer (the sender) is the test. */
function setup({ manual = false, zips = true } = {}) {
  const link = new TestLink(4);
  const sink = new MemorySink();
  sink.zips = zips;
  const hooks = new RecordingHooks();
  const source = new MemorySource();
  const engine = new Engine({ link, source, sink, hooks, manual });
  const peer = async (...messages: ControlMessage[]) => {
    for (const message of messages) engine.onControl(message);
    await settle();
  };
  const meta = (fileId: string, size: number, name = `${fileId}.bin`) =>
    peer({
      type: "meta",
      fileId,
      name,
      size,
      mime: "application/octet-stream",
      hash: fileIdentity(name, size, 1),
    });
  const start = (fileId: string, streamId: number, chunkSize = 4) =>
    peer({ type: "start", fileId, chunkSize, streamId });
  const frame = async (streamId: number, bytes: Uint8Array) => {
    engine.onFrame(packFrame(streamId, bytes));
    await settle();
  };
  /** Announce, start and stream `data` as stream `streamId`. */
  const receive = async (fileId: string, streamId: number, data: Uint8Array, name?: string) => {
    await meta(fileId, data.byteLength, name);
    await start(fileId, streamId);
    for (let at = 0; at < data.byteLength; at += 4) await frame(streamId, data.slice(at, at + 4));
    await peer({ type: "done", fileId });
  };
  return { link, sink, hooks, engine, peer, meta, start, frame, receive };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("frame filtering", () => {
  test("late chunks of an aborted file are dropped; the next file holds only its bytes", async () => {
    const t = setup();
    const gate = Promise.withResolvers<void>();
    await t.meta("a", 12);
    await t.meta("b", 4);
    await t.start("a", 1);
    t.sink.beforeWrite = (download) => (download.offer.fileId === "a" ? gate.promise : undefined);
    t.engine.onFrame(packFrame(1, bytesOf(4, 1)));
    t.engine.onFrame(packFrame(1, bytesOf(4, 2)));
    await settle();

    // A's two frames are still queued behind the stalled write when A is dismissed.
    t.engine.dismiss("a");
    await t.start("b", 2);
    gate.resolve();
    await settle();
    expect(t.link.sent("resume").map((m) => m.fileId)).toStrictEqual(["a", "b"]);
    await t.frame(1, bytesOf(4, 3));
    await t.frame(2, bytesOf(4, 9));
    await t.peer({ type: "done", fileId: "b" });

    expect([...t.sink.file("b")!.bytes]).toStrictEqual([...bytesOf(4, 9)]);
    expect(t.sink.file("b")!.state).toBe("closed");
    expect(t.sink.file("a")!.state).toBe("discarded");
    expect(t.link.sent("ack").map((m) => m.fileId)).toStrictEqual(["b"]);
    expect(t.link.sent("credit").every((c) => c.fileId === "b")).toBe(true);
  });

  test("a frame with the current stream ID before resume is dropped", async () => {
    const t = setup();
    const gate = Promise.withResolvers<void>();
    t.sink.beforeOpen = () => gate.promise;
    await t.meta("a", 4);
    await t.start("a", 5);
    await t.frame(5, bytesOf(4));
    expect(t.link.sent("resume")).toHaveLength(0);

    gate.resolve();
    await settle();
    expect(t.link.sent("resume")).toHaveLength(1);
    expect(t.sink.file("a")!.bytes.byteLength).toBe(0);
    expect(t.link.sent("credit")).toHaveLength(0);
  });

  test("frames shorter than the header or of another stream are not counted", async () => {
    const t = setup();
    await t.meta("a", 4);
    await t.start("a", 1);
    t.engine.onFrame(new Uint8Array([0, 0, 1]));
    await t.frame(2, bytesOf(4));
    expect(t.hooks.of("bytes")).toHaveLength(0);
    await t.frame(1, bytesOf(4));
    expect(t.link.sent("credit")).toStrictEqual([{ type: "credit", fileId: "a", bytesWritten: 4 }]);
  });
});

describe("start and resume", () => {
  test("every start for a known offer is answered with resume", async () => {
    const t = setup();
    await t.peer({ type: "meta", fileId: "a", name: "a", size: 4, mime: "" });
    await t.start("a", 1);
    expect(t.link.sent("resume")).toStrictEqual([
      { type: "resume", fileId: "a", hash: "", bytesOffset: 0 },
    ]);
  });

  test("the resume offset is aligned down to the chunk size", async () => {
    const t = setup();
    const data = bytesOf(16);
    const hash = fileIdentity("a.bin", 16, 1);
    t.sink.partials.set(hash, data.slice(0, 10));
    await t.meta("a", 16);
    await t.start("a", 1, 4);
    expect(t.link.sent("resume")[0]).toMatchObject({ bytesOffset: 8, hash });

    await t.frame(1, data.slice(8, 12));
    await t.frame(1, data.slice(12));
    await t.peer({ type: "done", fileId: "a" });
    expect([...t.sink.file("a")!.bytes]).toStrictEqual([...data]);
    expect(t.link.sent("credit").at(-1)?.bytesWritten).toBe(16);
  });

  test("a partial as long as the file restarts at 0 with exact bytes", async () => {
    const t = setup();
    const data = bytesOf(16, 3);
    const hash = fileIdentity("a.bin", 16, 1);
    t.sink.partials.set(hash, bytesOf(16, 7));
    await t.meta("a", 16);
    await t.start("a", 1, 4);
    expect(t.link.sent("resume")[0]).toMatchObject({ bytesOffset: 0, hash });
    expect(t.sink.file("a")!.offset).toBe(0);

    for (let at = 0; at < 16; at += 4) await t.frame(1, data.slice(at, at + 4));
    await t.peer({ type: "done", fileId: "a" });
    expect([...t.sink.file("a")!.bytes]).toStrictEqual([...data]);
    expect(t.link.sent("ack").map((m) => m.fileId)).toStrictEqual(["a"]);
  });

  test("in manual mode a start for an unpulled offer is refused and the offer stays", async () => {
    const t = setup({ manual: true });
    await t.meta("a", 4);
    await t.start("a", 1);
    expect(t.link.sent("download-aborted")).toStrictEqual([
      { type: "download-aborted", fileId: "a" },
    ]);
    expect(t.link.sent("resume")).toHaveLength(0);
    expect(t.sink.downloads).toHaveLength(0);
    expect(t.hooks.row("a")).toMatchObject({ status: "pending" });

    t.engine.pull("a");
    await t.start("a", 2);
    await t.frame(2, bytesOf(4));
    await t.peer({ type: "done", fileId: "a" });
    expect(t.link.sent("resume").map((m) => m.fileId)).toStrictEqual(["a"]);
    expect(t.link.sent("ack").map((m) => m.fileId)).toStrictEqual(["a"]);
  });

  test("in manual mode a file sent back to pending must be pulled again", async () => {
    const t = setup({ manual: true });
    await t.meta("a", 8);
    t.engine.pull("a");
    await t.start("a", 1);
    t.sink.file("a")!.onAbort();
    await settle();
    await t.start("a", 2);
    expect(t.link.sent("resume")).toHaveLength(1);
    expect(t.link.sent("download-aborted")).toHaveLength(2);
  });

  test("in auto mode a start for an unpulled offer is accepted", async () => {
    const t = setup();
    await t.receive("a", 1, bytesOf(4));
    expect(t.link.sent("download-aborted")).toHaveLength(0);
    expect(t.link.sent("ack").map((m) => m.fileId)).toStrictEqual(["a"]);
  });

  test("a start for an unknown or dismissed file is answered with download-aborted", async () => {
    const t = setup();
    await t.start("ghost", 1);
    await t.meta("a", 4);
    t.engine.dismiss("a");
    await t.start("a", 2);
    expect(t.link.sent("download-aborted").map((m) => m.fileId)).toStrictEqual(["ghost", "a", "a"]);
    expect(t.link.sent("resume")).toHaveLength(0);
  });
});

describe("credits", () => {
  test("credits follow accepted bytes every 1 MiB, never arrival", async () => {
    const t = setup();
    const size = 3 * CREDIT_BATCH;
    await t.meta("a", size);
    await t.start("a", 1);
    const gate = Promise.withResolvers<void>();
    t.sink.beforeWrite = () => gate.promise;
    await t.frame(1, new Uint8Array(CREDIT_BATCH));
    expect(t.link.sent("credit")).toHaveLength(0);

    t.sink.beforeWrite = null;
    gate.resolve();
    await settle();
    await t.frame(1, new Uint8Array(CREDIT_BATCH / 2));
    await t.frame(1, new Uint8Array(CREDIT_BATCH * 1.5));
    expect(t.link.sent("credit").map((c) => c.bytesWritten)).toStrictEqual([
      CREDIT_BATCH,
      3 * CREDIT_BATCH,
    ]);
  });
});

describe("done", () => {
  test("ack is sent only after the download stream closed", async () => {
    const t = setup();
    let closedAtAck: string | undefined;
    t.link.peer = {
      onControl: (message) => {
        if (message.type === "ack") closedAtAck = t.sink.file("a")?.state;
      },
      onFrame: () => undefined,
    };
    await t.receive("a", 1, bytesOf(6));
    expect(closedAtAck).toBe("closed");
    expect(t.hooks.finishedOf("a")).toMatchObject({ status: "completed", direction: "received" });
  });

  test("done before the last frames waits for them", async () => {
    const t = setup();
    await t.meta("a", 8);
    await t.start("a", 1);
    await t.frame(1, bytesOf(4));
    await t.peer({ type: "done", fileId: "a" });
    expect(t.link.sent("ack")).toHaveLength(0);
    await t.frame(1, bytesOf(4));
    expect(t.link.sent("ack")).toHaveLength(1);
  });

  test("a short file is discarded with cancel after the grace period", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const t = setup();
    await t.meta("a", 8);
    await t.start("a", 1);
    await t.frame(1, bytesOf(4));
    await t.peer({ type: "done", fileId: "a" });
    await vi.advanceTimersByTimeAsync(DONE_GRACE);
    await settle();

    expect(t.link.sent("cancel")[0]).toMatchObject({ fileId: "a" });
    expect(t.link.sent("ack")).toHaveLength(0);
    expect(t.sink.file("a")!.state).toBe("discarded");
    expect(t.hooks.finishedOf("a")?.status).toBe("failed");
  });

  test("extra bytes fail the size check", async () => {
    const t = setup();
    await t.meta("a", 4);
    await t.start("a", 1);
    await t.frame(1, bytesOf(6));
    await t.peer({ type: "done", fileId: "a" });
    expect(t.link.sent("cancel")[0]?.reason).toMatch(/Size mismatch/);
    expect(t.sink.file("a")!.state).toBe("discarded");
  });
});

describe("write failures", () => {
  test("a rejected write ends only the current file; later files still write", async () => {
    const t = setup();
    t.sink.beforeWrite = (download) => {
      if (download.offer.fileId === "a") throw new Error("Disk full");
    };
    await t.receive("a", 1, bytesOf(8));
    expect(t.link.sent("cancel")).toStrictEqual([
      { type: "cancel", fileId: "a", reason: "Disk full" },
    ]);
    expect(t.hooks.of("error").map((e) => e.message)).toStrictEqual(["Disk full"]);
    expect(t.hooks.finishedOf("a")?.status).toBe("failed");

    await t.receive("b", 2, bytesOf(8, 5));
    expect([...t.sink.file("b")!.bytes]).toStrictEqual([...bytesOf(8, 5)]);
    expect(t.link.sent("ack").map((m) => m.fileId)).toStrictEqual(["b"]);
  });

  test("a failed open answers with cancel and the next file still opens", async () => {
    const t = setup();
    t.sink.beforeOpen = (offer) => {
      if (offer.fileId === "a") throw new Error("No space");
    };
    await t.meta("a", 4);
    await t.start("a", 1);
    expect(t.link.sent("cancel")[0]).toMatchObject({ fileId: "a", reason: "No space" });
    await t.receive("b", 2, bytesOf(4));
    expect(t.link.sent("ack").map((m) => m.fileId)).toStrictEqual(["b"]);
  });
});

describe("file too large for the sink", () => {
  test("a refused open answers download-aborted, keeps the offer pending and toasts", async () => {
    const t = setup();
    t.sink.beforeOpen = (offer) => {
      if (offer.fileId === "a") throw new FileTooLargeError(16);
    };
    await t.meta("a", 4);
    await t.start("a", 1);

    expect(t.link.sent("cancel")).toStrictEqual([]);
    expect(t.link.sent("download-aborted")).toStrictEqual([
      { type: "download-aborted", fileId: "a" },
    ]);
    expect(t.hooks.of("error").map((e) => e.message)).toStrictEqual([
      new FileTooLargeError(16).message,
    ]);
    expect(t.hooks.finishedOf("a")).toBeUndefined();
    expect(t.hooks.row("a")?.status).toBe("pending");

    await t.receive("b", 2, bytesOf(4));
    expect(t.link.sent("ack").map((m) => m.fileId)).toStrictEqual(["b"]);

    // The offer is still known: a later start for it is answered with resume.
    t.sink.beforeOpen = null;
    await t.start("a", 3);
    expect(t.link.sent("resume").map((m) => m.fileId)).toStrictEqual(["b", "a"]);
  });
});

describe("dismiss, cancel and user abort", () => {
  test("dismissing a pending offer tells the sender and drops the partial", async () => {
    const t = setup({ manual: true });
    await t.meta("a", 4);
    t.engine.dismiss("a");
    await settle();
    expect(t.link.sent("download-aborted")).toStrictEqual([
      { type: "download-aborted", fileId: "a" },
    ]);
    expect(t.sink.dropped).toStrictEqual(["a"]);
    expect(t.hooks.of("removed").map((e) => e.fileId)).toStrictEqual(["a"]);
    t.engine.pull("a");
    expect(t.link.sent("pull")).toHaveLength(0);
  });

  test("dismissing mid-download discards the stream and its partial", async () => {
    const t = setup();
    await t.meta("a", 8);
    await t.start("a", 1);
    await t.frame(1, bytesOf(4));
    t.engine.dismiss("a");
    await settle();
    expect(t.sink.file("a")!.state).toBe("discarded");
    expect(t.sink.dropped).toStrictEqual(["a"]);
    expect(t.link.sent("download-aborted")).toHaveLength(1);
  });

  test("a peer cancel removes the file and discards it", async () => {
    const t = setup();
    await t.meta("a", 8);
    await t.start("a", 1);
    await t.peer({ type: "cancel", fileId: "a", reason: "gone" });
    expect(t.sink.file("a")!.state).toBe("discarded");
    expect(t.hooks.of("removed").map((e) => e.fileId)).toStrictEqual(["a"]);
    expect(t.link.sent("cancel")).toHaveLength(0);
  });

  test("a download stopped by the user keeps its partial and goes back to pending", async () => {
    const t = setup();
    await t.meta("a", 8);
    await t.start("a", 1);
    await t.frame(1, bytesOf(4));
    t.sink.file("a")!.onAbort();
    await settle();
    expect(t.link.sent("download-aborted")).toStrictEqual([
      { type: "download-aborted", fileId: "a" },
    ]);
    expect(t.hooks.row("a")).toMatchObject({ status: "pending", bytesTransferred: 0 });
    expect(t.sink.partials.get(fileIdentity("a.bin", 8, 1))?.byteLength).toBe(4);

    await t.start("a", 2);
    expect(t.link.sent("resume").at(-1)).toMatchObject({ bytesOffset: 4 });
  });
});

describe("peer loss", () => {
  test("closes the open writer and finalizes open zips", async () => {
    const t = setup();
    await t.meta("z", 4);
    await t.meta("a", 8);
    t.engine.pullBatch(["z"], "batch.zip");
    await t.start("a", 1);
    await t.frame(1, bytesOf(4));
    t.link.close();
    await settle();

    expect(t.sink.file("a")!.state).toBe("aborted");
    expect(t.sink.partials.get(fileIdentity("a.bin", 8, 1))?.byteLength).toBe(4);
    expect(t.sink.archives.map((a) => a.finalized)).toStrictEqual([1]);
  });

  test("a writer that finishes opening after the loss is closed too", async () => {
    const t = setup();
    const gate = Promise.withResolvers<void>();
    t.sink.beforeOpen = () => gate.promise;
    await t.meta("a", 8);
    await t.start("a", 1);
    t.link.close();
    gate.resolve();
    await settle();
    expect(t.sink.file("a")!.state).toBe("aborted");
    expect(t.link.sent("resume")).toHaveLength(0);
  });
});

describe("archives", () => {
  test("a single-file pull-batch is finalized and the next pull is not appended", async () => {
    const t = setup({ manual: true });
    await t.meta("a", 4);
    await t.meta("b", 4);
    t.engine.pullBatch(["a"], "one.zip");
    await settle();
    expect(t.link.sent("pull-batch")).toStrictEqual([{ type: "pull-batch", fileIds: ["a"] }]);
    await t.start("a", 1);
    await t.frame(1, bytesOf(4));
    await t.peer({ type: "done", fileId: "a" });

    const [zip] = t.sink.archives;
    expect(zip?.name).toBe("one.zip");
    expect(zip?.finalized).toBe(1);
    expect(zip?.entries.map((e) => e.offer.fileId)).toStrictEqual(["a"]);

    t.engine.pull("b");
    await t.receive("b", 2, bytesOf(4));
    expect(zip?.entries).toHaveLength(1);
    expect(t.sink.downloads.map((d) => d.offer.fileId)).toStrictEqual(["b"]);
  });

  test("a pull-batch zip is finalized once, after its last file", async () => {
    const t = setup({ manual: true });
    await t.meta("a", 4);
    await t.meta("b", 4);
    t.engine.pullBatch(["a", "b"]);
    await t.start("a", 1);
    await t.frame(1, bytesOf(4));
    await t.peer({ type: "done", fileId: "a" });
    expect(t.sink.archives[0]?.finalized).toBe(0);
    await t.peer({ type: "cancel", fileId: "b" });
    expect(t.sink.archives[0]?.finalized).toBe(1);
  });

  test("a stopped pull-batch zip sends its files back to pending", async () => {
    const t = setup({ manual: true });
    await t.meta("a", 8);
    await t.meta("b", 4);
    t.engine.pullBatch(["a", "b"]);
    await t.start("a", 1);
    t.sink.archives[0]!.onAbort();
    await settle();
    expect(t.link.sent("download-aborted").map((m) => m.fileId)).toStrictEqual(["a", "b"]);
    expect(t.hooks.row("b")?.status).toBe("pending");
  });

  test("auto-mode folder files share one zip, finalized on batch-done", async () => {
    const t = setup();
    await t.receive("a", 1, bytesOf(4), "photos/a.jpg");
    await t.receive("b", 2, bytesOf(4), "photos/b.jpg");
    expect(t.sink.archives.map((a) => a.name)).toStrictEqual(["photos.zip"]);
    expect(t.sink.archives[0]!.finalized).toBe(0);
    await t.peer({ type: "batch-done" });
    expect(t.sink.archives[0]!.finalized).toBe(1);
    expect(t.hooks.of("batchDone").map((e) => e.info)).toMatchObject([
      { direction: "received", fileCountInBatch: 2 },
    ]);
  });

  test("without zip support a pull-batch writes files directly", async () => {
    const t = setup({ manual: true, zips: false });
    await t.meta("a", 4, "dir/a.bin");
    t.engine.pullBatch(["a"]);
    await t.start("a", 1);
    await t.frame(1, bytesOf(4));
    await t.peer({ type: "done", fileId: "a" });
    expect(t.sink.downloads.map((d) => [d.offer.fileId, d.state])).toStrictEqual([["a", "closed"]]);
  });
});

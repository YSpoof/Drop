import { describe, expect, test } from "vitest";

import {
  FALLBACK_CHUNK,
  FRAME_HEADER,
  MAX_CHUNK,
  chunkSizeFor,
  decodeControl,
  encodeControl,
  fileIdentity,
  packFrame,
  unpackFrame,
  type ControlMessage,
} from "./protocol";

const hash = fileIdentity("document.pdf", 1_048_576, 1_700_000_000_000);

/** The exact JSON objects of `crates/cli/src/protocol_tests.rs`. */
const WIRE: [ControlMessage, object][] = [
  [
    {
      type: "meta",
      fileId: "f-123",
      name: "document.pdf",
      size: 1_048_576,
      mime: "application/pdf",
      hash,
    },
    {
      type: "meta",
      fileId: "f-123",
      name: "document.pdf",
      size: 1048576,
      mime: "application/pdf",
      hash: "document.pdf|1048576|1700000000000",
    },
  ],
  [
    { type: "start", fileId: "f-123", chunkSize: 65_536, streamId: 7 },
    { type: "start", fileId: "f-123", chunkSize: 65536, streamId: 7 },
  ],
  [
    { type: "resume", fileId: "f-123", hash, bytesOffset: 262_144 },
    { type: "resume", fileId: "f-123", hash, bytesOffset: 262144 },
  ],
  [
    { type: "credit", fileId: "f-123", bytesWritten: 1_048_576 },
    { type: "credit", fileId: "f-123", bytesWritten: 1048576 },
  ],
  [
    { type: "done", fileId: "f-123" },
    { type: "done", fileId: "f-123" },
  ],
  [
    { type: "ack", fileId: "f-123" },
    { type: "ack", fileId: "f-123" },
  ],
  [{ type: "batch-done" }, { type: "batch-done" }],
  [{ type: "bye" }, { type: "bye" }],
  [
    { type: "cancel", fileId: "f-123", reason: "User cancelled" },
    { type: "cancel", fileId: "f-123", reason: "User cancelled" },
  ],
  [
    { type: "download-mode", manual: true },
    { type: "download-mode", manual: true },
  ],
  [
    { type: "pull", fileId: "f-123" },
    { type: "pull", fileId: "f-123" },
  ],
  [
    { type: "pull-batch", fileIds: ["f-1", "f-2"] },
    { type: "pull-batch", fileIds: ["f-1", "f-2"] },
  ],
  [
    { type: "download-aborted", fileId: "f-123" },
    { type: "download-aborted", fileId: "f-123" },
  ],
];

describe("control messages", () => {
  test("file identity matches the CLI", () => {
    expect(hash).toBe("document.pdf|1048576|1700000000000");
  });

  test("every message has the exact wire shape of the Rust CLI and round-trips", () => {
    expect(WIRE).toHaveLength(13);
    for (const [message, expected] of WIRE) {
      const text = encodeControl(message);
      expect(JSON.parse(text)).toStrictEqual(expected);
      expect(decodeControl(text)).toStrictEqual(message);
    }
  });

  test("optional fields are written only when set", () => {
    const start: ControlMessage = {
      type: "start",
      fileId: "f-123",
      chunkSize: 65_536,
      streamId: 1,
      offset: 4096,
    };
    expect(JSON.parse(encodeControl(start))).toStrictEqual({
      type: "start",
      fileId: "f-123",
      chunkSize: 65536,
      streamId: 1,
      offset: 4096,
    });
    expect(JSON.parse(encodeControl({ type: "cancel", fileId: "f-123" }))).toStrictEqual({
      type: "cancel",
      fileId: "f-123",
    });
  });

  test("decodes CLI messages, defaulting mime and dropping unknown fields", () => {
    expect(decodeControl('{"type":"meta","fileId":"a","name":"x/y.txt","size":3}')).toStrictEqual({
      type: "meta",
      fileId: "a",
      name: "x/y.txt",
      size: 3,
      mime: "",
    });
    expect(
      decodeControl(
        '{"type":"start","fileId":"a","chunkSize":262140,"streamId":4294967295,"extra":1}',
      ),
    ).toStrictEqual({ type: "start", fileId: "a", chunkSize: 262_140, streamId: 0xffff_ffff });
  });

  test("start requires a u32 stream ID", () => {
    expect(decodeControl('{"type":"start","fileId":"a","chunkSize":1}')).toBeNull();
    expect(decodeControl('{"type":"start","fileId":"a","chunkSize":1,"streamId":-1}')).toBeNull();
    expect(
      decodeControl('{"type":"start","fileId":"a","chunkSize":1,"streamId":4294967296}'),
    ).toBeNull();
  });

  test("rejects unknown types, missing or mistyped fields and bad JSON", () => {
    for (const text of [
      '{"type":"auto"}',
      '{"type":"toString"}',
      "not json",
      "null",
      '"pull"',
      '{"type":"pull"}',
      '{"type":"pull","fileId":7}',
      '{"type":"pull-batch","fileIds":["a",1]}',
      '{"type":"credit","fileId":"a","bytesWritten":1.5}',
      '{"type":"download-mode","manual":"yes"}',
    ]) {
      expect(decodeControl(text), text).toBeNull();
    }
  });
});

describe("files frames", () => {
  test("header is the stream ID as u32 big-endian, then the file bytes", () => {
    const frame = packFrame(0x0102_0304, new Uint8Array([104, 105]));
    expect([...frame]).toStrictEqual([1, 2, 3, 4, 104, 105]);
    expect(packFrame(0xffff_ffff, new Uint8Array()).byteLength).toBe(FRAME_HEADER);
  });

  test("unpack reads the stream ID and the bytes after the header", () => {
    const parsed = unpackFrame(new Uint8Array([1, 2, 3, 4, 104, 105]));
    expect(parsed?.streamId).toBe(0x0102_0304);
    expect([...parsed!.bytes]).toStrictEqual([104, 105]);
    const empty = unpackFrame(new Uint8Array([0, 0, 0, 9]));
    expect([empty?.streamId, empty?.bytes.byteLength]).toStrictEqual([9, 0]);
  });

  test("unpack honours a view into a larger buffer", () => {
    const backing = new Uint8Array([9, 9, 0, 0, 0, 5, 42]);
    const parsed = unpackFrame(backing.subarray(2));
    expect([parsed?.streamId, ...parsed!.bytes]).toStrictEqual([5, 42]);
  });

  test("frames shorter than the header are rejected", () => {
    expect(unpackFrame(new Uint8Array([0, 0, 1]))).toBeNull();
    expect(unpackFrame(new Uint8Array())).toBeNull();
  });
});

describe("chunk size", () => {
  test("a whole frame fits min(max, 256 KiB)", () => {
    for (const max of [1_073_741_823, 262_145, 262_144, 131_072, 16_384]) {
      const chunk = chunkSizeFor(max);
      expect(chunk + FRAME_HEADER).toBe(Math.min(max, MAX_CHUNK));
    }
    expect(chunkSizeFor(1_073_741_823)).toBe(262_140);
  });

  test("zero, infinite or unknown maximum falls back to 64 KiB frames", () => {
    for (const max of [0, Number.POSITIVE_INFINITY, Number.NaN, null, undefined, -1]) {
      expect(chunkSizeFor(max)).toBe(FALLBACK_CHUNK - FRAME_HEADER);
    }
    expect(chunkSizeFor(undefined)).toBe(65_532);
  });
});

import { describe, expect, it } from "vitest";

import { formatBytes, formatSpeed } from "./format";

const KiB = 1024;
const TiB = KiB ** 4;

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [0.4, "0 B"],
    [0.999, "0 B"],
    [-1, "0 B"],
    [-5 * KiB, "0 B"],
    [Number.NaN, "0 B"],
    [1, "1 B"],
    [1023, "1023 B"],
    [KiB, "1.0 KB"],
    [1.5 * KiB, "1.5 KB"],
    [KiB ** 2, "1.0 MB"],
    [KiB ** 3, "1.0 GB"],
    [TiB, "1.0 TB"],
    [2.5 * TiB, "2.5 TB"],
    [2048 * TiB, "2048.0 TB"],
  ])("%d → %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("formatSpeed", () => {
  it.each([
    [0, "0 B/s"],
    [-10, "0 B/s"],
    [0.5, "0 B/s"],
    [KiB, "1.0 KB/s"],
  ])("%d → %s", (bytes, expected) => {
    expect(formatSpeed(bytes)).toBe(expected);
  });
});

import type { Channel, Peer } from "fastrtc";
import { describe, expect, it, vi } from "vitest";

import { packFrame } from "#lib/transfer/protocol.js";

import { CTRL_LABEL, FILES_LABEL, PeerLink, type Inbound } from "./link";

class FakeChannel extends EventTarget {
  readyState: RTCDataChannelState = "open";
  maxMessageSize = 1 << 30;
  readonly sent: unknown[] = [];
  async send(data: unknown) {
    this.sent.push(data);
  }
  emit(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

function fakePeer() {
  const channels = { [CTRL_LABEL]: new FakeChannel(), [FILES_LABEL]: new FakeChannel() };
  const opened = {
    [CTRL_LABEL]: Promise.withResolvers<void>(),
    [FILES_LABEL]: Promise.withResolvers<void>(),
  };
  const peer = {
    open: async (label: typeof CTRL_LABEL | typeof FILES_LABEL) => {
      await opened[label].promise;
      return channels[label] as unknown as Channel;
    },
  } as unknown as Peer;
  return { peer, channels, opened };
}

function recorder(): Inbound & { got: unknown[] } {
  const got: unknown[] = [];
  return { got, onControl: (message) => got.push(message), onFrame: (frame) => got.push(frame) };
}

describe("PeerLink", () => {
  it("buffers traffic from a channel that opened first until attach", async () => {
    const { peer, channels, opened } = fakePeer();
    const link = new PeerLink();
    const open = link.open(peer);

    opened[CTRL_LABEL].resolve();
    await Promise.resolve();
    await Promise.resolve();
    channels[CTRL_LABEL].emit(JSON.stringify({ type: "download-mode", manual: false }));
    channels[CTRL_LABEL].emit("not json");
    opened[FILES_LABEL].resolve();
    await open;
    const frame = packFrame(1, new Uint8Array([7]));
    channels[FILES_LABEL].emit(frame.buffer);

    const target = recorder();
    link.attach(target);
    expect(target.got).toEqual([{ type: "download-mode", manual: false }, frame]);
    expect(link.chunkSize).toBe(256 * 1024 - 4);
  });

  it("closes when either channel closes and stops sending", async () => {
    const { peer, channels, opened } = fakePeer();
    opened[CTRL_LABEL].resolve();
    opened[FILES_LABEL].resolve();
    const link = new PeerLink();
    await link.open(peer);
    const onClosed = vi.fn();
    link.closed.addEventListener("abort", onClosed);

    channels[FILES_LABEL].dispatchEvent(new Event("close"));
    link.sendControl({ type: "bye" });

    expect(onClosed).toHaveBeenCalledOnce();
    expect(channels[CTRL_LABEL].sent).toEqual([]);
    await expect(link.sendFrame(new Uint8Array(5))).rejects.toThrow("Link closed");
  });
});

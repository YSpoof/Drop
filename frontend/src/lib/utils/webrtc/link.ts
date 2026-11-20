import type { Channel, Peer } from "fastrtc";

import {
  chunkSizeFor,
  decodeControl,
  encodeControl,
  type ControlMessage,
} from "#lib/transfer/protocol.js";
import type { Link } from "#lib/transfer/types.js";

export const CTRL_LABEL = "ctrl";
export const FILES_LABEL = "files";

/** Where inbound traffic goes once the engine exists. */
export interface Inbound {
  onControl(message: ControlMessage): void;
  onFrame(frame: Uint8Array): void;
}

/**
 * `Link` over the fastrtc `ctrl` and `files` channels. Listens to each channel as soon as it
 * opens and buffers inbound traffic until `attach`, so nothing sent by a faster peer is lost.
 */
export class PeerLink implements Link {
  chunkSize = chunkSizeFor(undefined);
  private readonly lost = new AbortController();
  readonly closed = this.lost.signal;
  private ctrl: Channel | null = null;
  private files: Channel | null = null;
  private target: Inbound | null = null;
  private backlog: ((target: Inbound) => void)[] = [];

  /** Resolves once both channels are open; rejects when the peer closes first. */
  async open(peer: Peer) {
    const signal = this.closed;
    const [ctrl, files] = await Promise.all([
      peer
        .open(CTRL_LABEL, { signal })
        .then((channel) => this.listen(channel, (data) => this.onCtrl(data))),
      peer
        .open(FILES_LABEL, { signal })
        .then((channel) => this.listen(channel, (data) => this.onFiles(data))),
    ]);
    this.ctrl = ctrl;
    this.files = files;
    this.chunkSize = chunkSizeFor(files.maxMessageSize);
  }

  /** Delivers the buffered traffic, then every later message, to `target`. */
  attach(target: Inbound) {
    this.target = target;
    for (const deliver of this.backlog.splice(0)) deliver(target);
  }

  close() {
    this.lost.abort();
    this.backlog = [];
  }

  sendControl(message: ControlMessage) {
    if (this.closed.aborted || !this.ctrl) return;
    this.ctrl.send(encodeControl(message)).catch(() => undefined);
  }

  sendFrame(frame: Uint8Array): Promise<void> {
    if (this.closed.aborted || !this.files) return Promise.reject(new Error("Link closed"));
    return this.files.send(frame as Uint8Array<ArrayBuffer>, { signal: this.closed });
  }

  private listen(channel: Channel, onMessage: (data: unknown) => void) {
    const signal = this.closed;
    channel.addEventListener("message", ({ data }) => onMessage(data), { signal });
    channel.addEventListener("close", () => this.close(), { signal });
    if (channel.readyState !== "open") this.close();
    return channel;
  }

  private onCtrl(data: unknown) {
    if (typeof data !== "string") return;
    const message = decodeControl(data);
    if (message) this.deliver((target) => target.onControl(message));
  }

  private onFiles(data: unknown) {
    if (!(data instanceof ArrayBuffer)) return;
    const frame = new Uint8Array(data);
    this.deliver((target) => target.onFrame(frame));
  }

  private deliver(handle: (target: Inbound) => void) {
    if (this.closed.aborted) return;
    if (this.target) handle(this.target);
    else this.backlog.push(handle);
  }
}

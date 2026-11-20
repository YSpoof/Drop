//! Transfer engine for one peer connection (D4): routes `ctrl` messages to the receiver and
//! the sender (`cancel` to both), and exposes the UI commands. The owner builds the `Link`,
//! feeds it inbound traffic through `onControl`/`onFrame`, and aborts `link.closed` on loss.

import type { ControlMessage } from "./protocol";
import { Receiver } from "./receive";
import { Sender } from "./send";
import type { Hooks, Link, Sink, Source } from "./types";

export interface EngineOptions {
  link: Link;
  source: Source;
  sink: Sink;
  hooks: Hooks;
  /** Local download mode, announced with `download-mode` right away. */
  manual: boolean;
}

export class Engine {
  private readonly link: Link;
  private readonly hooks: Hooks;
  private readonly sender: Sender;
  private readonly receiver: Receiver;
  private manual: boolean | null = null;
  private closed = false;
  /** Settles when the send loop ends (after `close()`). */
  readonly done: Promise<void>;

  constructor({ link, source, sink, hooks, manual }: EngineOptions) {
    this.link = link;
    this.hooks = hooks;
    this.sender = new Sender(link, source, hooks);
    this.receiver = new Receiver(link, sink, hooks);
    this.setManual(manual);
    this.done = this.sender.run();
    link.closed.addEventListener("abort", () => this.close(), { once: true });
    if (link.closed.aborted) this.close();
  }

  onControl(message: ControlMessage) {
    if (this.closed) return;
    const { sender, receiver } = this;
    switch (message.type) {
      case "meta":
        receiver.onMeta(offerOf(message));
        break;
      case "start":
        receiver.onStart(message);
        break;
      case "done":
        receiver.onDone(message.fileId);
        break;
      case "batch-done":
        receiver.onBatchDone();
        break;
      case "bye":
        this.hooks.bye();
        break;
      case "cancel":
        receiver.onCancel(message.fileId);
        sender.onCancel(message.fileId);
        break;
      case "download-mode":
        sender.onDownloadMode(message.manual);
        break;
      case "pull":
        sender.onPull([message.fileId]);
        break;
      case "pull-batch":
        sender.onPull(message.fileIds);
        break;
      case "download-aborted":
        sender.onDownloadAborted(message.fileId);
        break;
      case "resume":
        sender.onResume(message);
        break;
      case "credit":
        sender.onCredit(message);
        break;
      case "ack":
        sender.onAck(message.fileId);
        break;
    }
  }

  onFrame(frame: Uint8Array) {
    if (!this.closed) this.receiver.onFrame(frame);
  }

  /** The app's send queue changed: announce new files and wake the sender. */
  queueChanged() {
    this.sender.queueChanged();
  }

  setManual(manual: boolean) {
    if (this.manual === manual) return;
    this.manual = manual;
    this.receiver.manual = manual;
    this.link.sendControl({ type: "download-mode", manual });
  }

  pull(fileId: string) {
    this.receiver.pull(fileId);
  }

  pullBatch(fileIds: string[], zipName?: string) {
    this.receiver.pullBatch(fileIds, zipName);
  }

  /** Removes a received offer or download. */
  dismiss(fileId: string) {
    this.receiver.dismiss(fileId);
  }

  /** Removes a file from the send side. */
  cancel(fileId: string) {
    this.sender.cancel(fileId);
  }

  bye() {
    this.link.sendControl({ type: "bye" });
  }

  /** Peer loss or teardown: stops the sender and closes open downloads. */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.sender.close();
    this.receiver.close();
  }
}

function offerOf({ type: _, ...offer }: Extract<ControlMessage, { type: "meta" }>) {
  return offer;
}

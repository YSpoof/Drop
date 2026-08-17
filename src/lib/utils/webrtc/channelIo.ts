import { logger } from "#lib/utils/logger.js";

import { describeControlMessage, encodeControlMessage, type ControlMessage } from "./protocol";

/** Backpressure-aware DataChannel writer for control + files channels. */
export class DataChannelIo {
  constructor(
    private readonly control: RTCDataChannel,
    private readonly files: RTCDataChannel,
    private readonly isAborted: () => boolean,
    private readonly bufferHighWater: number,
    private readonly bufferLowWater: number,
  ) {}

  async sendBuffer(data: ArrayBuffer): Promise<void> {
    await this.sendOnChannel(this.files, data);
  }

  sendControl(message: ControlMessage): Promise<void> {
    logger.log(`(Ctrl) → ${describeControlMessage(message)}`);
    if (this.control.readyState === "open") {
      return this.sendOnChannel(this.control, encodeControlMessage(message));
    }
    return Promise.resolve();
  }

  private async waitUntilCanSend(channel: RTCDataChannel, bytes: number): Promise<void> {
    if (channel.readyState !== "open") return;

    while (channel.bufferedAmount + bytes > this.bufferHighWater) {
      if (this.isAborted()) return;

      const { promise, resolve } = Promise.withResolvers<void>();
      let poll: ReturnType<typeof setInterval> | undefined;

      const cleanup = () => {
        channel.removeEventListener("bufferedamountlow", onDrain);
        if (poll) clearInterval(poll);
      };
      const finish = () => {
        cleanup();
        resolve();
      };
      const onDrain = () => {
        if (channel.bufferedAmount + bytes <= this.bufferHighWater) finish();
      };

      if (channel.bufferedAmount + bytes <= this.bufferHighWater) {
        resolve();
      } else {
        channel.bufferedAmountLowThreshold = this.bufferLowWater;
        channel.addEventListener("bufferedamountlow", onDrain);
        poll = setInterval(onDrain, 25);
        await promise;
        if (this.isAborted()) return;
      }
    }
  }

  private async sendOnChannel(channel: RTCDataChannel, data: ArrayBuffer | string): Promise<void> {
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;

    while (channel.readyState === "open" && !this.isAborted()) {
      await this.waitUntilCanSend(channel, bytes);
      if (channel.readyState !== "open" || this.isAborted()) return;
      try {
        if (typeof data === "string") channel.send(data);
        else channel.send(data);
        return;
      } catch (error) {
        if (
          error instanceof DOMException &&
          (error.name === "OperationError" || error.name === "InvalidStateError")
        ) {
          if (channel.readyState !== "open") return;
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, 10);
          await promise;
          continue;
        }
        throw error;
      }
    }
  }
}

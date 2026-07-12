import { encodeControlMessage, type ControlMessage } from "./protocol";

/** Backpressure-aware DataChannel writer shared by send + control paths. */
export class DataChannelIo {
  constructor(
    private readonly channel: RTCDataChannel,
    private readonly isAborted: () => boolean,
    private readonly bufferHighWater: number,
    private readonly bufferLowWater: number,
  ) {}

  async sendBuffer(data: ArrayBuffer | string): Promise<void> {
    const bytes =
      typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;

    while (this.channel.readyState === "open" && !this.isAborted()) {
      await this.waitUntilCanSend(bytes);
      if (this.channel.readyState !== "open" || this.isAborted()) return;
      try {
        if (typeof data === "string") {
          this.channel.send(data);
        } else {
          this.channel.send(data);
        }
        return;
      } catch (error) {
        if (
          error instanceof DOMException &&
          (error.name === "OperationError" || error.name === "InvalidStateError")
        ) {
          if (this.channel.readyState !== "open") return;
          const { promise, resolve } = Promise.withResolvers<void>();
          setTimeout(resolve, 10);
          await promise;
          continue;
        }
        throw error;
      }
    }
  }

  async waitUntilCanSend(bytes: number): Promise<void> {
    if (this.channel.readyState !== "open") return;

    while (this.channel.bufferedAmount + bytes > this.bufferHighWater) {
      if (this.isAborted()) return;

      const { promise, resolve } = Promise.withResolvers<void>();
      let poll: ReturnType<typeof setInterval> | undefined;

      const cleanup = () => {
        this.channel.removeEventListener("bufferedamountlow", onDrain);
        if (poll) clearInterval(poll);
      };
      const finish = () => {
        cleanup();
        resolve();
      };
      const onDrain = () => {
        if (this.channel.bufferedAmount + bytes <= this.bufferHighWater) finish();
      };

      if (this.channel.bufferedAmount + bytes <= this.bufferHighWater) {
        resolve();
      } else {
        this.channel.bufferedAmountLowThreshold = this.bufferLowWater;
        this.channel.addEventListener("bufferedamountlow", onDrain);
        poll = setInterval(onDrain, 25);
        await promise;
        if (this.isAborted()) return;
      }
    }
  }

  sendControl(message: ControlMessage): Promise<void> {
    if (this.channel.readyState === "open") {
      return this.sendBuffer(encodeControlMessage(message));
    }
    return Promise.resolve();
  }
}

import type { BatchInfo, Direction, Finished } from "./types";

/** Why a file stopped early. */
export type StopKind = "aborted" | "cancelled" | "failed" | "lost";

export class Stop extends Error {
  constructor(
    readonly kind: StopKind,
    message: string = kind,
  ) {
    super(message);
    this.name = "Stop";
  }
}

/** The `Stop` behind `error`: the signal's reason when aborted, else a failure. */
export function stopOf(error: unknown, signal: AbortSignal): Stop {
  if (signal.aborted && signal.reason instanceof Stop) return signal.reason;
  if (error instanceof Stop) return error;
  return new Stop("failed", errorMessage(error));
}

export function errorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

/**
 * Awaits `promise`, rejecting with the signal's reason once it aborts, or with a failed
 * `Stop(timeoutReason)` after `ms` when `ms` is given.
 */
export async function within<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  ms?: number,
  timeoutReason = "Timed out",
): Promise<T> {
  const race = Promise.withResolvers<T>();
  const onAbort = () => race.reject(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();
  const timer =
    ms === undefined
      ? undefined
      : setTimeout(() => race.reject(new Stop("failed", timeoutReason)), ms);
  promise.then(race.resolve, race.reject);
  try {
    return await race.promise;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

/** Groups finished files until the batch closes (`batch-done`). */
export class Batch {
  private id = crypto.randomUUID();
  private count = 0;

  constructor(private readonly direction: Direction) {}

  /** A finished entry stamped with this batch. */
  entry(
    file: { id: string; name: string; size: number },
    status: Finished["status"],
    reason?: string,
  ): Finished {
    this.count += 1;
    return {
      id: file.id,
      name: file.name,
      size: file.size,
      direction: this.direction,
      status,
      timestamp: Date.now(),
      batchId: this.id,
      fileCountInBatch: this.count,
      ...(reason === undefined ? {} : { reason }),
    };
  }

  /** Closes the batch; `null` when no file finished in it. */
  close(): BatchInfo | null {
    if (this.count === 0) return null;
    const info = { batchId: this.id, direction: this.direction, fileCountInBatch: this.count };
    this.id = crypto.randomUUID();
    this.count = 0;
    return info;
  }
}

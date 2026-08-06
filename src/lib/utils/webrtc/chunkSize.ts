import { logger } from "$lib/utils/logger";

const BUFFER_LOW_WATER = 16 * 1024;
const BUFFER_HIGH_WATER = 256 * 1024;
export const MIN_CHUNK_SIZE = 16 * 1024;

export function resolveChunkSize(sctp: RTCSctpTransport | null): number {
  const max = sctp?.maxMessageSize;
  if (!max || max < MIN_CHUNK_SIZE) {
    throw new Error("SCTP maxMessageSize unavailable or too small");
  }
  const size = Math.max(MIN_CHUNK_SIZE, max);
  logger.info("(Chunk) Negotiated size:", size);
  return size;
}

export function resolveBufferHighWater(chunkSize: number): number {
  return Math.max(BUFFER_HIGH_WATER, chunkSize * 4);
}

export function resolveBufferLowWater(chunkSize: number): number {
  return Math.max(BUFFER_LOW_WATER, chunkSize);
}

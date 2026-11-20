const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Values below 1 (fractions, negatives, NaN) clamp to "0 B". */
export function formatBytes(bytes: number): string {
  if (!(bytes >= 1)) return "0 B";
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${UNITS[index]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

import type { LockerPort } from "#lib/ports/locker.js";

/** No-op: web platform cannot lock files on disk. */
export class WebLocker implements LockerPort {
  async lock(): Promise<void> {}
  async unlock(): Promise<void> {}
}

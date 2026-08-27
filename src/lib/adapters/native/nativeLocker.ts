import type { LockerPort } from "#lib/ports/locker.js";
import type { NativeApi } from "#native";

export class NativeLocker implements LockerPort {
  constructor(private readonly api: NativeApi) {}

  lock(absPath: string): Promise<void> {
    return this.api.lockFile(absPath);
  }

  unlock(absPath: string): Promise<void> {
    return this.api.unlockFile(absPath);
  }
}

import type { LockerPort } from "#lib/ports/locker.js";

/**
 * Tracks file locks for queued files.
 * Works for both folder-sourced and individually-added files.
 *
 * Key: QueuedFile.id  →  Value: absolute disk path
 */
export class FileLockManager {
  private locks = new Map<string, string>(); // fileId → absPath

  constructor(private readonly locker: LockerPort) {}

  /** Lock a file and register it. No-op in the web build. */
  async lock(fileId: string, absPath: string): Promise<void> {
    this.locks.set(fileId, absPath);
    await this.locker.lock(absPath);
  }

  /** Unlock a single file by its queue ID. No-op if unknown or web build. */
  async unlock(fileId: string): Promise<void> {
    const absPath = this.locks.get(fileId);
    if (!absPath) return;
    this.locks.delete(fileId);
    await this.locker.unlock(absPath);
  }

  /** Unlock all tracked files and clear the registry. */
  async unlockAll(): Promise<void> {
    const paths = [...this.locks.values()];
    this.locks.clear();
    await Promise.all(paths.map((p) => this.locker.unlock(p)));
  }

  hasLock(fileId: string): boolean {
    return this.locks.has(fileId);
  }
}

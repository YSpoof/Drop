export type LockerPort = {
  lock(absPath: string): Promise<void>;
  unlock(absPath: string): Promise<void>;
};

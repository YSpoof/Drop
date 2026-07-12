let sentinel: WakeLockSentinel | null = null;
let shouldHoldLock = false;

export function setWakeLockConnected(connected: boolean) {
  shouldHoldLock = connected;
  if (!connected) {
    void releaseWakeLock();
  }
}

export async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible" || !shouldHoldLock) {
    return null;
  }

  if (sentinel) return sentinel;

  try {
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
      if (shouldHoldLock && document.visibilityState === "visible") {
        void requestWakeLock();
      }
    });
    return sentinel;
  } catch {
    return null;
  }
}

export async function releaseWakeLock(): Promise<void> {
  if (!sentinel) return;

  try {
    await sentinel.release();
  } catch {
    // already released
  }
  sentinel = null;
}

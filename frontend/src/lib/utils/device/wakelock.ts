let sentinel: WakeLockSentinel | null = null;

export async function requestWakeLock(): Promise<WakeLockSentinel | null> {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") {
    return null;
  }

  if (sentinel) return sentinel;

  try {
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
      if (document.visibilityState === "visible") {
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

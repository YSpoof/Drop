const HOST_NOTIFY_TAG = "drop-host-background";

let lastNotification: Notification | null = null;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const result = await Notification.requestPermission();
  return result === "granted";
}

export function notifyHostBackground(): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

  lastNotification?.close();
  lastNotification = new Notification("Mantenha o Drop aberto", {
    body: "O compartilhamento via link só funciona em primeiro plano.",
    icon: "/favicon.svg",
    requireInteraction: true,
    tag: HOST_NOTIFY_TAG,
  });
  lastNotification.onclick = () => {
    globalThis.focus();
    lastNotification?.close();
    lastNotification = null;
  };
}

export function closeHostBackgroundNotify(): void {
  lastNotification?.close();
  lastNotification = null;
}

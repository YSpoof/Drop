const AUTO_CONNECT_NOTIFY_TAG = "drop-auto-connect-background";

let lastNotification: Notification | null = null;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;

  const result = await Notification.requestPermission();
  return result === "granted";
}

export function notifyAutoConnectBackground(): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

  lastNotification?.close();
  lastNotification = new Notification("Auto-conexão INATIVA", {
    body: "O Drop só funciona com o app aberto em primeiro plano.",
    icon: "/static/images/pwa/192.png",
    requireInteraction: true,
    tag: AUTO_CONNECT_NOTIFY_TAG,
  });
}

export function closeAutoConnectBackgroundNotify(): void {
  lastNotification?.close();
  lastNotification = null;
}

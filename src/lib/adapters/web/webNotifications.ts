import type { NotificationsPort } from "#lib/ports/notifications.js";

const HOST_NOTIFY_TAG = "drop-host-background";

export class WebNotifications implements NotificationsPort {
  readonly needsPermissionForHostShare = true;
  #lastNotification: Notification | null = null;

  async ensurePermission(): Promise<boolean> {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;

    const result = await Notification.requestPermission();
    return result === "granted";
  }

  notifyHostBackground(): void {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    this.#lastNotification?.close();
    this.#lastNotification = new Notification("Mantenha o Drop aberto", {
      body: "O compartilhamento via link só funciona em primeiro plano.",
      icon: "/favicon.svg",
      requireInteraction: true,
      tag: HOST_NOTIFY_TAG,
    });
    this.#lastNotification.onclick = () => {
      globalThis.focus();
      this.#lastNotification?.close();
      this.#lastNotification = null;
    };
  }

  closeHostBackground(): void {
    this.#lastNotification?.close();
    this.#lastNotification = null;
  }
}

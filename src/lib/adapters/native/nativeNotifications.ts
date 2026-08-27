import type { NotificationsPort } from "#lib/ports/notifications.js";

export class NativeNotifications implements NotificationsPort {
  readonly needsPermissionForHostShare = false;

  async ensurePermission(): Promise<boolean> {
    return true;
  }

  notifyHostBackground(): void {}

  closeHostBackground(): void {}
}

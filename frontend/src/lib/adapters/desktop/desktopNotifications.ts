import { NotificationsPort } from "#lib/ports/notifications.js";

export class DesktopNotifications extends NotificationsPort {
  readonly needsPermissionForHostShare = false;

  async ensurePermission(): Promise<boolean> {
    return true;
  }

  notifyHostBackground(): void {}

  closeHostBackground(): void {}
}

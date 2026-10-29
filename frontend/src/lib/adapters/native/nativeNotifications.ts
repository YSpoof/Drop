import { NotificationsPort } from "#lib/ports/notifications.js";

export class NativeNotifications extends NotificationsPort {
  readonly needsPermissionForHostShare = false;

  async ensurePermission(): Promise<boolean> {
    return true;
  }

  notifyHostBackground(): void {}

  closeHostBackground(): void {}
}

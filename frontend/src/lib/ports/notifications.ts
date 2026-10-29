export abstract class NotificationsPort {
  abstract readonly needsPermissionForHostShare: boolean;
  abstract ensurePermission(): Promise<boolean>;
  abstract notifyHostBackground(): void;
  abstract closeHostBackground(): void;
}

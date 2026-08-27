export type NotificationsPort = {
  readonly needsPermissionForHostShare: boolean;
  ensurePermission(): Promise<boolean>;
  notifyHostBackground(): void;
  closeHostBackground(): void;
};

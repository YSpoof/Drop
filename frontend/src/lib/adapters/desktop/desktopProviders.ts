import { DesktopEnvironment } from "#lib/adapters/desktop/desktopEnvironment.js";
import { DesktopFileReader } from "#lib/adapters/desktop/desktopFileReader.js";
import { DesktopFsFileAdapter } from "#lib/adapters/desktop/desktopFsFileAdapter.js";
import { DesktopNotifications } from "#lib/adapters/desktop/desktopNotifications.js";
import { DesktopPicker } from "#lib/adapters/desktop/desktopPicker.js";
import { DesktopReceiveFolder } from "#lib/adapters/desktop/desktopReceiveFolder.js";
import { DesktopWatcher } from "#lib/adapters/desktop/desktopWatcher.js";
import { EnvironmentPort } from "#lib/ports/environment.js";
import { FileAdapterPort } from "#lib/ports/fileAdapter.js";
import { FileReaderPort } from "#lib/ports/fileReader.js";
import { NotificationsPort } from "#lib/ports/notifications.js";
import { PickerPort } from "#lib/ports/picker.js";
import { ReceiveFolderPort } from "#lib/ports/receiveFolder.js";
import { WatcherPort } from "#lib/ports/watcher.js";

export const desktopProviders = [
  { provide: EnvironmentPort, useClass: DesktopEnvironment },
  { provide: NotificationsPort, useClass: DesktopNotifications },
  { provide: WatcherPort, useClass: DesktopWatcher },
  { provide: PickerPort, useClass: DesktopPicker },
  { provide: FileAdapterPort, useClass: DesktopFsFileAdapter },
  { provide: FileReaderPort, useClass: DesktopFileReader },
  { provide: ReceiveFolderPort, useClass: DesktopReceiveFolder },
];

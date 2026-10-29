import { SwFileAdapter } from "#lib/adapters/web/swFileAdapter.js";
import { WebClipboard } from "#lib/adapters/web/webClipboard.js";
import { WebEnvironment } from "#lib/adapters/web/webEnvironment.js";
import { WebFileReader } from "#lib/adapters/web/webFileReader.js";
import { WebNotifications } from "#lib/adapters/web/webNotifications.js";
import { WebPicker } from "#lib/adapters/web/webPicker.js";
import { WebReceiveFolder } from "#lib/adapters/web/webReceiveFolder.js";
import { WebWatcher } from "#lib/adapters/web/webWatcher.js";
import { ClipboardPort } from "#lib/ports/clipboard.js";
import { EnvironmentPort } from "#lib/ports/environment.js";
import { FileAdapterPort } from "#lib/ports/fileAdapter.js";
import { FileReaderPort } from "#lib/ports/fileReader.js";
import { NotificationsPort } from "#lib/ports/notifications.js";
import { PickerPort } from "#lib/ports/picker.js";
import { ReceiveFolderPort } from "#lib/ports/receiveFolder.js";
import { WatcherPort } from "#lib/ports/watcher.js";

export const webProviders = [
  { provide: EnvironmentPort, useClass: WebEnvironment },
  { provide: NotificationsPort, useClass: WebNotifications },
  { provide: WatcherPort, useClass: WebWatcher },
  { provide: PickerPort, useClass: WebPicker },
  { provide: FileAdapterPort, useClass: SwFileAdapter },
  { provide: FileReaderPort, useClass: WebFileReader },
  { provide: ReceiveFolderPort, useClass: WebReceiveFolder },
  { provide: ClipboardPort, useClass: WebClipboard },
];

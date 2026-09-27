import { NativeEnvironment } from "#lib/adapters/native/nativeEnvironment.js";
import { NativeFileReader } from "#lib/adapters/native/nativeFileReader.js";
import { NativeFsFileAdapter } from "#lib/adapters/native/nativeFsFileAdapter.js";
import { NativeNotifications } from "#lib/adapters/native/nativeNotifications.js";
import { NativeReceiveFolder } from "#lib/adapters/native/nativeReceiveFolder.js";
import { NativeWatcher } from "#lib/adapters/native/nativeWatcher.js";
import { neutralinoApi } from "#lib/adapters/native/neutralinoApi.js";
import { NeutralinoPicker } from "#lib/adapters/native/neutralinoPicker.js";
import { WebClipboard } from "#lib/adapters/web/webClipboard.js";
import { ClipboardPort } from "#lib/ports/clipboard.js";
import { EnvironmentPort } from "#lib/ports/environment.js";
import { FileAdapterPort } from "#lib/ports/fileAdapter.js";
import { FileReaderPort } from "#lib/ports/fileReader.js";
import { NativeApi } from "#lib/ports/nativeApi.js";
import { NotificationsPort } from "#lib/ports/notifications.js";
import { PickerPort } from "#lib/ports/picker.js";
import { ReceiveFolderPort } from "#lib/ports/receiveFolder.js";
import { WatcherPort } from "#lib/ports/watcher.js";

export const nativeProviders = [
  { provide: NativeApi, useValue: neutralinoApi },
  { provide: EnvironmentPort, useClass: NativeEnvironment },
  { provide: NotificationsPort, useClass: NativeNotifications },
  { provide: WatcherPort, useClass: NativeWatcher },
  { provide: PickerPort, useClass: NeutralinoPicker },
  { provide: FileAdapterPort, useClass: NativeFsFileAdapter },
  { provide: FileReaderPort, useClass: NativeFileReader },
  { provide: ReceiveFolderPort, useClass: NativeReceiveFolder },
  { provide: ClipboardPort, useClass: WebClipboard },
];

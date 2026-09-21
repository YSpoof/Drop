import { isNative } from "#lib/adapters/native/isNative.js";
import { NativeEnvironment } from "#lib/adapters/native/nativeEnvironment.js";
import { NativeFileReader } from "#lib/adapters/native/nativeFileReader.js";
import { NativeFsFileAdapter } from "#lib/adapters/native/nativeFsFileAdapter.js";
import { NativeNotifications } from "#lib/adapters/native/nativeNotifications.js";
import { NativeReceiveFolder } from "#lib/adapters/native/nativeReceiveFolder.js";
import { NativeWatcher } from "#lib/adapters/native/nativeWatcher.js";
import { neutralinoApi } from "#lib/adapters/native/neutralinoApi.js";
import { startNeutralino } from "#lib/adapters/native/neutralinoClient.js";
import { NeutralinoPicker } from "#lib/adapters/native/neutralinoPicker.js";
import { SwFileAdapter } from "#lib/adapters/web/swFileAdapter.js";
import { WebClipboard } from "#lib/adapters/web/webClipboard.js";
import { WebEnvironment } from "#lib/adapters/web/webEnvironment.js";
import { WebFileReader } from "#lib/adapters/web/webFileReader.js";
import { WebNotifications } from "#lib/adapters/web/webNotifications.js";
import { WebPicker } from "#lib/adapters/web/webPicker.js";
import { WebReceiveFolder } from "#lib/adapters/web/webReceiveFolder.js";
import { WebWatcher } from "#lib/adapters/web/webWatcher.js";
import { DownloadService } from "#lib/services/downloadService.js";
import { FolderWatcher } from "#lib/services/folderWatcher.js";
import { QueueService } from "#lib/services/queueService.js";
import { TransferService } from "#lib/services/transferService.js";
import { transferStore } from "#lib/stores/transferStore.svelte.js";

const native = isNative();
if (native) startNeutralino();

export const receiveFolder = native
  ? new NativeReceiveFolder(neutralinoApi)
  : new WebReceiveFolder();
export const environment = native ? new NativeEnvironment() : new WebEnvironment();
export const fileReader = native ? new NativeFileReader(neutralinoApi) : new WebFileReader();
export const watcher = native ? new NativeWatcher(neutralinoApi) : new WebWatcher();
export const picker = native ? new NeutralinoPicker() : new WebPicker();

export const downloadService = new DownloadService(
  native
    ? new NativeFsFileAdapter(
        neutralinoApi,
        async () => transferStore.receiveFolderPath || (await receiveFolder.defaultPath()) || "",
      )
    : new SwFileAdapter(),
);

export const folderWatcher = new FolderWatcher(watcher, fileReader);
export const queueService = new QueueService(fileReader, folderWatcher);
export const transferService = new TransferService(fileReader, downloadService, environment);

export const notifications = native ? new NativeNotifications() : new WebNotifications();
export const clipboard = new WebClipboard();

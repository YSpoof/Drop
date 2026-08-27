import { ipcBridge, isElectron } from "#lib/adapters/native/ipcBridge.js";
import { NativeEnvironment } from "#lib/adapters/native/nativeEnvironment.js";
import { NativeFileReader } from "#lib/adapters/native/nativeFileReader.js";
import { NativeFsFileAdapter } from "#lib/adapters/native/nativeFsFileAdapter.js";
import { NativeLocker } from "#lib/adapters/native/nativeLocker.js";
import { NativeNotifications } from "#lib/adapters/native/nativeNotifications.js";
import { NativeReceiveFolder } from "#lib/adapters/native/nativeReceiveFolder.js";
import { NativeWatcher } from "#lib/adapters/native/nativeWatcher.js";
import { SwFileAdapter } from "#lib/adapters/web/swFileAdapter.js";
import { WebClipboard } from "#lib/adapters/web/webClipboard.js";
import { WebEnvironment } from "#lib/adapters/web/webEnvironment.js";
import { WebFileReader } from "#lib/adapters/web/webFileReader.js";
import { WebLocker } from "#lib/adapters/web/webLocker.js";
import { WebNotifications } from "#lib/adapters/web/webNotifications.js";
import { WebReceiveFolder } from "#lib/adapters/web/webReceiveFolder.js";
import { WebWatcher } from "#lib/adapters/web/webWatcher.js";
import { DownloadService } from "#lib/services/downloadService.js";
import { FileLockManager } from "#lib/services/fileLockManager.js";
import { FolderWatcher } from "#lib/services/folderWatcher.js";
import { QueueService } from "#lib/services/queueService.js";
import { TransferService } from "#lib/services/transferService.js";
import { transferStore } from "#lib/stores/transferStore.svelte.js";

const native = isElectron();

export const receiveFolder = native ? new NativeReceiveFolder(ipcBridge) : new WebReceiveFolder();
export const environment = native ? new NativeEnvironment() : new WebEnvironment();
export const fileReader = native ? new NativeFileReader(ipcBridge) : new WebFileReader();
export const locker = native ? new NativeLocker(ipcBridge) : new WebLocker();
export const watcher = native ? new NativeWatcher(ipcBridge) : new WebWatcher();

export const downloadService = new DownloadService(
  native
    ? new NativeFsFileAdapter(
        ipcBridge,
        async () => transferStore.receiveFolderPath || (await receiveFolder.defaultPath()) || "",
      )
    : new SwFileAdapter(),
);

export const fileLockManager = new FileLockManager(locker);
export const folderWatcher = new FolderWatcher(fileLockManager, watcher, fileReader);
export const queueService = new QueueService(fileReader, fileLockManager, folderWatcher);
export const transferService = new TransferService(fileReader, downloadService, environment);

export const notifications = native ? new NativeNotifications() : new WebNotifications();
export const clipboard = new WebClipboard();

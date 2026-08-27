import path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, ipcMain } from "electron";

import { apiHandlers } from "./handlers.js";
import { createFolderWatchHandlers } from "./modules/folderWatch.js";

const PROD_URL = "https://drop.lzart.com.br";
const DEV_URL = "http://localhost:4321";

const dirname = path.dirname(fileURLToPath(import.meta.url));

function assertAuthorizedSender(event: Electron.IpcMainInvokeEvent) {
  const frameUrl = event.senderFrame?.url;
  if (!frameUrl) {
    throw new Error("Unauthorized IPC request: no sender frame");
  }

  const senderUrl = new URL(frameUrl);
  if (
    senderUrl.origin !== PROD_URL &&
    senderUrl.hostname !== "localhost" &&
    senderUrl.hostname !== "127.0.0.1"
  ) {
    throw new Error("Unauthorized IPC request from origin: " + senderUrl.origin);
  }
}

for (const [channel, handler] of Object.entries(apiHandlers)) {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertAuthorizedSender(event);
    return (handler as (...handlerArgs: unknown[]) => unknown)(...args);
  });
}

app.whenReady().then(() => {
  const win = new BrowserWindow({
    title: "Drop",
    width: 1024,
    height: 768,
    minWidth: 400,
    minHeight: 600,
    center: true,
    webPreferences: {
      preload: path.join(dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const folderWatchHandlers = createFolderWatchHandlers(win);
  for (const [ch, handler] of Object.entries(folderWatchHandlers)) {
    ipcMain.handle(ch, (event, ...args: unknown[]) => {
      assertAuthorizedSender(event);
      return (handler as (...a: unknown[]) => unknown)(...args);
    });
  }

  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: "detach" });
  }

  win.loadURL(app.isPackaged ? PROD_URL : DEV_URL);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

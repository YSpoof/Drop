import type { WatcherEvent } from "#lib/ports/watcher.js";
import type { NativeApi } from "#native";

export const isElectron = () => typeof window !== "undefined" && !!window.electronRPC?.isDesktop;

export const ipcBridge = new Proxy({} as NativeApi, {
  get: (_target, prop: string) => {
    return (...args: unknown[]) => {
      if (!isElectron()) {
        throw new Error(`Cannot call native API '${prop}' in the web browser.`);
      }
      return window.electronRPC!.invoke(prop, ...args);
    };
  },
});

export function onFolderWatchEvent(listener: (event: WatcherEvent) => void): () => void {
  if (!isElectron()) return () => {};
  return window.electronRPC!.on("folder-watch-event", listener as never);
}

/** Absolute disk path for a native File. Stamps `file.path` so later readers see it. */
export function nativeFilePath(file: File): string {
  const tagged = file as File & { path?: string };
  if (tagged.path) return tagged.path;
  if (!isElectron()) return "";
  try {
    const abs = window.electronRPC!.getPathForFile(file);
    if (abs) tagged.path = abs;
    return abs;
  } catch {
    return "";
  }
}

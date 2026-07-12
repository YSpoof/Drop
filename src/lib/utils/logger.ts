import { appState } from "$lib/stores/appState.svelte";

export const logger = {
  log: (...message: any[]) => {
    if (!appState.devMode) return;
    setTimeout(() => console.log(...message));
  },
  info: (...message: any[]) => {
    if (!appState.devMode) return;
    setTimeout(() => console.info(...message));
  },
  warn: (...message: any[]) => {
    if (!appState.devMode) return;
    setTimeout(() => console.warn(...message));
  },
  error: (...message: any[]) => {
    if (!appState.devMode) return;
    setTimeout(() => {
      console.error(...message);
    });
  },
};

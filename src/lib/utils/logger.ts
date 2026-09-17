import { uiStore } from "#lib/stores/uiStore.svelte.js";

export const logger = {
  log: (...message: any[]) => {
    if (!uiStore.devMode) return;
    setTimeout(() => console.log(...message));
  },
  info: (...message: any[]) => {
    if (!uiStore.devMode) return;
    setTimeout(() => console.info(...message));
  },
  warn: (...message: any[]) => {
    if (!uiStore.devMode) return;
    setTimeout(() => console.warn(...message));
  },
  error: (...message: any[]) => {
    if (!uiStore.devMode) return;
    setTimeout(() => {
      console.error(...message);
    });
  },
};

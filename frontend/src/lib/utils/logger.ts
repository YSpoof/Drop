import { uiStore } from "#lib/stores/uiStore.svelte.js";

export const logger = {
  log: (...message: any[]) => {
    if (!uiStore.devMode) return;
    setTimeout(() => console.log(...message));
  },
};

import { inject } from "quick-di";
import { onDestroy } from "svelte";

import { ClipboardPort } from "#lib/ports/clipboard.js";

const COPIED_MS = 2500;

/**
 * Copies text and flags which control copied it for a short time.
 * Call during component init: the reset timer is cleared on destroy.
 */
export function createCopied<K extends string = "copied">() {
  const clipboard = inject(ClipboardPort);
  let current = $state<K | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  onDestroy(() => clearTimeout(timer));

  return {
    get current() {
      return current;
    },
    async copy(text: string, key: K): Promise<boolean> {
      try {
        await clipboard.writeText(text);
      } catch {
        return false;
      }
      current = key;
      clearTimeout(timer);
      timer = setTimeout(() => {
        current = null;
      }, COPIED_MS);
      return true;
    },
  };
}

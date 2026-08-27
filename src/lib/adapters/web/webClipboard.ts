import type { ClipboardPort } from "#lib/ports/clipboard.js";

export class WebClipboard implements ClipboardPort {
  async writeText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }
}

import { ClipboardPort } from "#lib/ports/clipboard.js";

export class WebClipboard extends ClipboardPort {
  async writeText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }
}

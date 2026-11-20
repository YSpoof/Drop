import { inject } from "quick-di";

import { ClipboardPort } from "#lib/ports/clipboard.js";
import { DesktopApi } from "#lib/ports/desktopApi.js";

export class DesktopClipboard extends ClipboardPort {
  private readonly api = inject(DesktopApi);

  async writeText(text: string): Promise<void> {
    await this.api.writeClipboardText(text);
  }
}

import { inject } from "quick-di";

import { ClipboardPort } from "#lib/ports/clipboard.js";
import { NativeApi } from "#lib/ports/nativeApi.js";

export class NativeClipboard extends ClipboardPort {
  private readonly api = inject(NativeApi);

  async writeText(text: string): Promise<void> {
    await this.api.writeClipboardText(text);
  }
}

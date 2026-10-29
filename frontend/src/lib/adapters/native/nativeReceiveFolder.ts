import { inject } from "quick-di";

import { NativeApi } from "#lib/ports/nativeApi.js";
import { ReceiveFolderPort } from "#lib/ports/receiveFolder.js";

export class NativeReceiveFolder extends ReceiveFolderPort {
  readonly canPick = true;
  private readonly api = inject(NativeApi);

  defaultPath(): Promise<string | null> {
    return this.api.getDownloadsPath();
  }

  pick(defaultPath?: string): Promise<string | null> {
    return this.api.pickFolder(defaultPath);
  }
}

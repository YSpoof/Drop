import { inject } from "quick-di";

import { DesktopApi } from "#lib/ports/desktopApi.js";
import { ReceiveFolderPort } from "#lib/ports/receiveFolder.js";

export class DesktopReceiveFolder extends ReceiveFolderPort {
  readonly canPick = true;
  private readonly api = inject(DesktopApi);

  defaultPath(): Promise<string | null> {
    return this.api.getDownloadsPath();
  }

  pick(defaultPath?: string): Promise<string | null> {
    return this.api.pickFolder(defaultPath);
  }
}

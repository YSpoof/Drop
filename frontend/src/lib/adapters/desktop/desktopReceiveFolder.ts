import { desktopApi } from "#lib/adapters/desktop/desktopApi.js";
import { ReceiveFolderPort } from "#lib/ports/receiveFolder.js";

export class DesktopReceiveFolder extends ReceiveFolderPort {
  readonly canPick = true;

  defaultPath(): Promise<string | null> {
    return desktopApi.getDownloadsPath();
  }

  pick(defaultPath?: string): Promise<string | null> {
    return desktopApi.pickFolder(defaultPath);
  }
}

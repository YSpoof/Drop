import type { NativeApi } from "#lib/ports/nativeApi.js";
import type { ReceiveFolderPort } from "#lib/ports/receiveFolder.js";

export class NativeReceiveFolder implements ReceiveFolderPort {
  readonly canPick = true;

  constructor(private readonly api: NativeApi) {}

  defaultPath(): Promise<string | null> {
    return this.api.getDownloadsPath();
  }

  pick(defaultPath?: string): Promise<string | null> {
    return this.api.pickFolder(defaultPath);
  }
}

import type { ReceiveFolderPort } from "#lib/ports/receiveFolder.js";

export class WebReceiveFolder implements ReceiveFolderPort {
  readonly canPick = false;

  async defaultPath(): Promise<string | null> {
    return null;
  }

  async pick(): Promise<string | null> {
    return null;
  }
}

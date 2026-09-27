import { ReceiveFolderPort } from "#lib/ports/receiveFolder.js";

export class WebReceiveFolder extends ReceiveFolderPort {
  readonly canPick = false;

  async defaultPath(): Promise<string | null> {
    return null;
  }

  async pick(): Promise<string | null> {
    return null;
  }
}

export abstract class ReceiveFolderPort {
  abstract readonly canPick: boolean;
  abstract defaultPath(): Promise<string | null>;
  abstract pick(defaultPath?: string): Promise<string | null>;
}

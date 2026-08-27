export type ReceiveFolderPort = {
  readonly canPick: boolean;
  defaultPath(): Promise<string | null>;
  pick(defaultPath?: string): Promise<string | null>;
};

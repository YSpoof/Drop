export type ClipboardPort = {
  writeText(text: string): Promise<void>;
};

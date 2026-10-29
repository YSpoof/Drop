export abstract class ClipboardPort {
  abstract writeText(text: string): Promise<void>;
}

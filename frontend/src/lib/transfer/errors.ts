const MiB = 1024 * 1024;

/**
 * The sink cannot save a file this large. The receiver refuses it with `download-aborted`,
 * so the offer stays pending and the sender moves on; the message is the user-facing toast.
 */
export class FileTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(
      `Arquivo grande demais para este navegador sem suporte a downloads em streaming ` +
        `(máx. ${limit / MiB} MiB). Use outro navegador ou o app desktop.`,
    );
    this.name = "FileTooLargeError";
  }
}

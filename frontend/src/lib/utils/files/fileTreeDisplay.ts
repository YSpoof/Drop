import { formatBytes } from "#lib/utils/files/format.js";
import type { TransferItem } from "#lib/utils/files/transferTypes.js";
import type { UnifiedItem } from "#lib/utils/files/tree.js";

export function queueFileSubtitle(item: { file: { size: number } }): string {
  return `A enviar · ${formatBytes(item.file.size)}`;
}

export function historyFileSubtitle(item: TransferItem): string {
  if (item.status === "pending") {
    const label = item.direction === "sent" ? "Pronto para enviar" : "Pronto para receber";
    return `${label} · ${formatBytes(item.size)}`;
  }
  const label = item.direction === "sent" ? "Enviado" : "Recebido";
  return `${label} · ${formatBytes(item.size)}`;
}

export function unifiedFileSubtitle(u: UnifiedItem): string {
  if (u.type === "queue") return queueFileSubtitle(u.item);
  return historyFileSubtitle(u.item);
}

export function unifiedSizeDisplay(u: UnifiedItem): string {
  if (u.type === "queue") {
    return `0 B\n${formatBytes(u.item.file.size)}`;
  }
  if (
    u.item.status === "in-progress" &&
    u.item.bytesTransferred > 0 &&
    u.item.bytesTransferred < u.item.size
  ) {
    return `${formatBytes(u.item.bytesTransferred)}\n${formatBytes(u.item.size)}`;
  }
  return formatBytes(u.item.size);
}

export function canShowFileDownload(u: UnifiedItem, autoDownload: boolean): boolean {
  return (
    u.type === "history" &&
    u.item.direction === "received" &&
    u.item.status === "pending" &&
    !autoDownload
  );
}

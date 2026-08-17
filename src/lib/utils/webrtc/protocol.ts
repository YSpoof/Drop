import type { QueuedFile } from "#lib/utils/files/queue.js";
import type { BatchDoneInfo, HistoryEntry } from "#lib/utils/files/transferTypes.js";

export interface FileMeta {
  type: "meta";
  fileId: string;
  name: string;
  size: number;
  mime: string;
  zip?: boolean;
}

interface DoneMessage {
  type: "done";
  fileId: string;
}

interface AckMessage {
  type: "ack";
  fileId: string;
}

interface BatchDoneMessage {
  type: "batch-done";
}

interface ByeMessage {
  type: "bye";
}

interface DownloadModeMessage {
  type: "download-mode";
  manual: boolean;
}

interface PullMessage {
  type: "pull";
  fileId: string;
}

interface PullBatchMessage {
  type: "pull-batch";
  fileIds: string[];
}

interface CancelMessage {
  type: "cancel";
  fileId: string;
}

interface DownloadAbortedMessage {
  type: "download-aborted";
  fileId: string;
}

interface StartMessage {
  type: "start";
  fileId: string;
}

export type ControlMessage =
  | FileMeta
  | DoneMessage
  | AckMessage
  | BatchDoneMessage
  | ByeMessage
  | DownloadModeMessage
  | PullMessage
  | PullBatchMessage
  | CancelMessage
  | DownloadAbortedMessage
  | StartMessage;

export interface TransferProgress {
  fileId: string;
  fileName: string;
  fileSize: number;
  bytesTransferred: number;
  direction: "send" | "receive";
  status?: "pending" | "in-progress" | "completed" | "failed";
}

export interface TransferCallbacks {
  onProgress?: (progress: TransferProgress) => void;
  onChunkBytes?: (direction: "send" | "receive", bytes: number) => void;
  onHistory?: (entry: HistoryEntry) => void;
  onBatchDone?: (info: BatchDoneInfo) => void;
  onFileCancelled?: (fileId: string) => void;
  onFileDismissed?: (fileId: string) => void;
  onBye?: () => void;
  onAbort?: () => void;
  onDownloadError?: (message: string) => void;
  getSendQueue: () => QueuedFile[];
  isOfferer: boolean;
}

export interface ActiveBatch {
  id: string;
  fileCount: number;
}

export function parseControlMessage(raw: string): ControlMessage | null {
  try {
    return JSON.parse(raw) as ControlMessage;
  } catch {
    return null;
  }
}

export function encodeControlMessage(message: ControlMessage): string {
  return JSON.stringify(message);
}

export function describeControlMessage(message: ControlMessage): string {
  switch (message.type) {
    case "meta":
      return `meta name=${message.name} size=${message.size}${message.zip ? " zip" : ""}`;
    case "pull-batch":
      return `pull-batch count=${message.fileIds.length}`;
    case "batch-done":
    case "bye":
      return message.type;
    case "download-mode":
      return `download-mode manual=${message.manual}`;
    default:
      return `${message.type} fileId=${message.fileId}`;
  }
}

export class DownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownloadError";
  }
}

export interface HistoryEntry {
  id: string;
  name: string;
  size: number;
  direction: "sent" | "received";
  status: "pending" | "completed" | "failed" | "in-progress";
  timestamp: number;
  batchId?: string;
  fileCountInBatch?: number;
}

export interface BatchDoneInfo {
  batchId: string;
  direction: "sent" | "received";
  fileCountInBatch: number;
}

export interface TransferItem {
  id: string;
  name: string;
  size: number;
  direction: "sent" | "received";
  status: "pending" | "in-progress" | "completed" | "failed";
  bytesTransferred: number;
}

export interface CreateDownloadStreamOptions {
  size?: number;
  mime?: string;
  onAbort?: () => void;
}

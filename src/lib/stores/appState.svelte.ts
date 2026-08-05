import { loadIdentity, saveDisplayName } from "$lib/utils/device/identity";
import { loadAutoDownload } from "$lib/utils/files/prefs";
import { createQueuedFiles, type QueuedFile } from "$lib/utils/files/queue";
import {
  flushTransferStats,
  loadTransferStats,
  resetTransferStats as persistResetTransferStats,
  scheduleSaveTransferStats,
  type TransferStats,
} from "$lib/utils/files/transferStats";
import type { TransferItem } from "$lib/utils/files/transferTypes";
import { localForage } from "$lib/utils/localForage";
import type { PeerInfo } from "$lib/utils/signaling/types";
import vibrate from "$lib/utils/vibrate";

const identity = await loadIdentity();
const tutorialViewed = await localForage.getItem<boolean>("tutorialViewed");
const autoDownload = await loadAutoDownload();
const initialTransferStats = await loadTransferStats();
const initialDevMode = (await localForage.getItem<boolean>("devMode")) ?? false;

class AppState {
  readonly identity = identity;

  displayName = $state(identity.displayName);
  peers = $state<PeerInfo[]>([]);
  queue = $state<QueuedFile[]>([]);
  transfers = $state<TransferItem[]>([]);
  autoDownload = $state(autoDownload);
  transferStats = $state<TransferStats>(initialTransferStats);
  connectingPeerId = $state<string | null>(null);
  connectedPeerId = $state<string | null>(null);
  connectedPeerInfo = $state<PeerInfo | null>(null);
  localIps = $state<string[]>([]);
  connectionModalOpen = $state(false);
  pendingRequest = $state<PeerInfo | null>(null);
  unsupportedBrowserModalOpen = $state(false);
  roomJoinOpen = $state(false);
  roomJoinPhase = $state<"waiting" | "connecting" | "connected" | "failed">("waiting");
  roomJoinMode = $state<"auto" | "ask" | null>(null);
  roomJoinCode = $state<string | null>(null);
  roomJoinTargetPeerId = $state<string | null>(null);
  tutorialModalOpen = $state(!tutorialViewed);
  infoModalOpen = $state(false);
  statsModalOpen = $state(false);
  settingsModalOpen = $state(false);
  shareModalOpen = $state(false);
  shareNotifyModalOpen = $state(false);
  shareNotifyDenied = $state(false);
  devMode = $state(initialDevMode);
  installPrompt = $state<BeforeInstallPromptEvent | null>(null);

  connected = $derived(this.connectedPeerId !== null);

  visibleQueue = $derived(
    this.queue.filter(
      (item) => !this.transfers.some((entry) => entry.id === item.id && entry.direction === "sent"),
    ),
  );

  displayPeers = $derived.by(() => {
    if (!this.connectedPeerInfo) return this.peers;
    return [
      this.connectedPeerInfo,
      ...this.peers.filter((peer) => peer.peerId !== this.connectedPeerInfo!.peerId),
    ];
  });

  handleDisplayNameBlur() {
    saveDisplayName(this.displayName);
  }

  handleShareLinkClick(inRoom: boolean) {
    vibrate.light();
    if (inRoom) {
      this.shareModalOpen = true;
      return;
    }
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      this.shareModalOpen = true;
      return;
    }
    this.shareNotifyDenied = false;
    this.shareNotifyModalOpen = true;
  }

  setDevMode(value: boolean) {
    this.devMode = value;
    localForage.setItem("devMode", value);
  }

  setInstallPrompt(prompt: BeforeInstallPromptEvent) {
    this.installPrompt = prompt;
  }

  clearInstallPrompt() {
    this.installPrompt = null;
  }

  recordTransferStats(direction: "sent" | "received", bytes: number) {
    const next: TransferStats =
      direction === "sent"
        ? { ...this.transferStats, uploadBytes: this.transferStats.uploadBytes + bytes }
        : { ...this.transferStats, downloadBytes: this.transferStats.downloadBytes + bytes };
    this.transferStats = next;
    scheduleSaveTransferStats(next);
  }

  recordTransferFile(direction: "sent" | "received") {
    const next: TransferStats =
      direction === "sent"
        ? { ...this.transferStats, uploadFiles: this.transferStats.uploadFiles + 1 }
        : { ...this.transferStats, downloadFiles: this.transferStats.downloadFiles + 1 };
    this.transferStats = next;
    scheduleSaveTransferStats(next);
  }

  resetTransferStats() {
    this.transferStats = {
      uploadBytes: 0,
      downloadBytes: 0,
      uploadFiles: 0,
      downloadFiles: 0,
    };
    void flushTransferStats().then(() => persistResetTransferStats());
  }

  upsertTransfer(update: TransferItem) {
    const index = this.transfers.findIndex((item) => item.id === update.id);
    if (index >= 0) {
      this.transfers = this.transfers.with(index, { ...this.transfers[index]!, ...update });
    } else {
      this.transfers = [update, ...this.transfers];
    }
  }

  promoteToHistory(items: QueuedFile[]) {
    for (const item of items) {
      this.upsertTransfer({
        id: item.id,
        name: item.path,
        size: item.file.size,
        direction: "sent",
        status: "pending",
        bytesTransferred: 0,
      });
    }
  }

  appendQueue(items: QueuedFile[]) {
    this.queue = [...this.queue, ...items];
  }

  removeFile(id: string | string[]) {
    const ids = Array.isArray(id) ? new Set(id) : new Set([id]);
    this.queue = this.queue.filter((item) => !ids.has(item.id));
    this.transfers = this.transfers.filter((item) => !ids.has(item.id));
  }

  removeTransfer(id: string | string[]) {
    const ids = Array.isArray(id) ? new Set(id) : new Set([id]);
    this.transfers = this.transfers.filter((item) => !ids.has(item.id));
  }

  pendingReceivedIds(ids: string[]) {
    const idSet = new Set(ids);
    return this.transfers
      .filter(
        (item) => idSet.has(item.id) && item.direction === "received" && item.status === "pending",
      )
      .map((item) => item.id);
  }

  resetTransferState() {
    const queueIds = new Set(this.queue.map((item) => item.id));
    this.transfers = this.transfers
      .filter((item) => item.direction === "sent" && queueIds.has(item.id))
      .map((item) => ({ ...item, status: "pending" as const, bytesTransferred: 0 }));
  }

  /** Create queued files from picker/drop input (does not notify transfer manager). */
  createAndQueue(files: FileList | File[] | { file: File; path: string }[]) {
    const newItems = createQueuedFiles(files);
    this.appendQueue(newItems);
    return newItems;
  }
}

export const appState = new AppState();

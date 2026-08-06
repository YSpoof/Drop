import { deviceStore } from "./deviceStore.svelte";
import { peerStore } from "./peerStore.svelte";
import { transferStore } from "./transferStore.svelte";
import { uiStore } from "./uiStore.svelte";

import type { QueuedFile } from "$lib/utils/files/queue";
import type { TransferItem } from "$lib/utils/files/transferTypes";

class AppStateFacade {
  // --- Device Store ---
  get identity() { return deviceStore.identity; }
  get displayName() { return deviceStore.displayName; }
  set displayName(value) { deviceStore.displayName = value; }
  handleDisplayNameBlur() { deviceStore.handleDisplayNameBlur(); }

  // --- Peer Store ---
  get peers() { return peerStore.peers; }
  set peers(value) { peerStore.peers = value; }
  get connectingPeerId() { return peerStore.connectingPeerId; }
  set connectingPeerId(value) { peerStore.connectingPeerId = value; }
  get connectedPeerId() { return peerStore.connectedPeerId; }
  set connectedPeerId(value) { peerStore.connectedPeerId = value; }
  get connectedPeerInfo() { return peerStore.connectedPeerInfo; }
  set connectedPeerInfo(value) { peerStore.connectedPeerInfo = value; }
  get localIps() { return peerStore.localIps; }
  set localIps(value) { peerStore.localIps = value; }
  get pendingRequest() { return peerStore.pendingRequest; }
  set pendingRequest(value) { peerStore.pendingRequest = value; }
  get roomJoinPhase() { return peerStore.roomJoinPhase; }
  set roomJoinPhase(value) { peerStore.roomJoinPhase = value; }
  get roomJoinMode() { return peerStore.roomJoinMode; }
  set roomJoinMode(value) { peerStore.roomJoinMode = value; }
  get roomJoinCode() { return peerStore.roomJoinCode; }
  set roomJoinCode(value) { peerStore.roomJoinCode = value; }
  get roomJoinTargetPeerId() { return peerStore.roomJoinTargetPeerId; }
  set roomJoinTargetPeerId(value) { peerStore.roomJoinTargetPeerId = value; }
  get connected() { return peerStore.connected; }
  get displayPeers() { return peerStore.displayPeers; }

  // --- Transfer Store ---
  get queue() { return transferStore.queue; }
  set queue(value) { transferStore.queue = value; }
  get transfers() { return transferStore.transfers; }
  set transfers(value) { transferStore.transfers = value; }
  get autoDownload() { return transferStore.autoDownload; }
  set autoDownload(value) { transferStore.autoDownload = value; }
  get transferStats() { return transferStore.transferStats; }
  set transferStats(value) { transferStore.transferStats = value; }
  get visibleQueue() { return transferStore.visibleQueue; }
  
  recordTransferStats(direction: "sent" | "received", bytes: number) { transferStore.recordTransferStats(direction, bytes); }
  recordTransferFile(direction: "sent" | "received") { transferStore.recordTransferFile(direction); }
  resetTransferStats() { transferStore.resetTransferStats(); }
  upsertTransfer(update: TransferItem) { transferStore.upsertTransfer(update); }
  promoteToHistory(items: QueuedFile[]) { transferStore.promoteToHistory(items); }
  appendQueue(items: QueuedFile[]) { transferStore.appendQueue(items); }
  removeFile(id: string | string[]) { transferStore.removeFile(id); }
  removeTransfer(id: string | string[]) { transferStore.removeTransfer(id); }
  pendingReceivedIds(ids: string[]) { return transferStore.pendingReceivedIds(ids); }
  resetTransferState() { transferStore.resetTransferState(); }
  createAndQueue(files: FileList | File[] | { file: File; path: string }[]) { return transferStore.createAndQueue(files); }

  // --- UI Store ---
  get connectionModalOpen() { return uiStore.connectionModalOpen; }
  set connectionModalOpen(value) { uiStore.connectionModalOpen = value; }
  get unsupportedBrowserModalOpen() { return uiStore.unsupportedBrowserModalOpen; }
  set unsupportedBrowserModalOpen(value) { uiStore.unsupportedBrowserModalOpen = value; }
  get roomJoinOpen() { return uiStore.roomJoinOpen; }
  set roomJoinOpen(value) { uiStore.roomJoinOpen = value; }
  get tutorialModalOpen() { return uiStore.tutorialModalOpen; }
  set tutorialModalOpen(value) { uiStore.tutorialModalOpen = value; }
  get infoModalOpen() { return uiStore.infoModalOpen; }
  set infoModalOpen(value) { uiStore.infoModalOpen = value; }
  get statsModalOpen() { return uiStore.statsModalOpen; }
  set statsModalOpen(value) { uiStore.statsModalOpen = value; }
  get settingsModalOpen() { return uiStore.settingsModalOpen; }
  set settingsModalOpen(value) { uiStore.settingsModalOpen = value; }
  get shareModalOpen() { return uiStore.shareModalOpen; }
  set shareModalOpen(value) { uiStore.shareModalOpen = value; }
  get shareNotifyModalOpen() { return uiStore.shareNotifyModalOpen; }
  set shareNotifyModalOpen(value) { uiStore.shareNotifyModalOpen = value; }
  get shareNotifyDenied() { return uiStore.shareNotifyDenied; }
  set shareNotifyDenied(value) { uiStore.shareNotifyDenied = value; }
  get devMode() { return uiStore.devMode; }
  set devMode(value) { uiStore.devMode = value; }
  get installPrompt() { return uiStore.installPrompt; }
  set installPrompt(value) { uiStore.installPrompt = value; }

  handleShareLinkClick(inRoom: boolean) { uiStore.handleShareLinkClick(inRoom); }
  setDevMode(value: boolean) { uiStore.setDevMode(value); }
  setInstallPrompt(prompt: BeforeInstallPromptEvent) { uiStore.setInstallPrompt(prompt); }
  clearInstallPrompt() { uiStore.clearInstallPrompt(); }
}

export const appState = new AppStateFacade();

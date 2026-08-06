import { goto } from "$app/navigation";
import { page } from "$app/state";
import { appState } from "$lib/stores/appState.svelte";
import { lazyLoad } from "$lib/stores/lazyLoad.svelte";
import { toastStore } from "$lib/stores/toast.svelte";
import {
  closeHostBackgroundNotify,
  notifyHostBackground,
} from "$lib/utils/device/backgroundNotify";
import { releaseWakeLock, requestWakeLock } from "$lib/utils/device/wakelock";
import { feedback } from "$lib/utils/feedback";
import { createQueuedFile } from "$lib/utils/files/queue";
import { ensureServiceWorkerReady } from "$lib/utils/files/swDownload";
import { consumeSharedRecords } from "$lib/utils/files/webShare";
import type { SessionManager } from "$lib/utils/webrtc/SessionManager";
import { tick } from "svelte";

export function generateRoomId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export async function applyShareParams(
  session: SessionManager,
  mode: "manual" | "auto",
  room?: string,
) {
  feedback.light();

  const roomId = room ?? generateRoomId();
  const url = new URL(page.url);
  url.searchParams.set("room", roomId);
  url.searchParams.set("host", appState.identity.peerId);

  if (mode === "auto") {
    url.searchParams.set("auto", session.generateRoomCode());
  } else {
    url.searchParams.delete("auto");
  }

  await goto(`${url.pathname}${url.search}`, { keepFocus: true, noScroll: true });
  await tick();
  session.announce();
}

export async function leaveRoom(session: SessionManager, room: string | undefined) {
  feedback.light();
  if (!room) return;

  appState.shareModalOpen = false;
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 300);
  await promise;

  if (appState.connectedPeerId) session.disconnectPeer();

  const url = new URL(page.url);
  url.searchParams.delete("room");
  url.searchParams.delete("host");
  url.searchParams.delete("auto");
  const target = url.search ? `${url.pathname}${url.search}` : url.pathname;
  await goto(target, { keepFocus: true, noScroll: true });
  await tick();
  session.announce();
  toastStore.showToast("Saiu da sala", "info");
}

export async function recoverSharedFiles(session: SessionManager) {
  try {
    let hasFiles = false;
    const records = await consumeSharedRecords();

    for (const rec of records) {
      const groupId = crypto.randomUUID();
      const queued = rec.files.map((f) =>
        createQueuedFile(new File([f.blob], f.name, { type: f.type }), f.name, groupId),
      );
      if (queued.length > 1) {
        for (const item of queued) {
          item.zip = true;
        }
      }
      if (queued.length) {
        hasFiles = true;
        session.appendQueuedFiles(queued);
      }
    }

    if (hasFiles) {
      toastStore.showToast("Arquivo(s) adicionado(s) na fila", "success");
      session.notifyQueueChanged();
    }
  } catch (e) {
    toastStore.showToast("Falha ao recuperar arquivos compartilhados", "error");
    console.error("Failed to recover shared files", e);
  }
}

export async function initSessionPage(session: SessionManager) {
  void requestWakeLock();

  const swAvailable = await ensureServiceWorkerReady();
  if (!swAvailable) {
    appState.unsupportedBrowserModalOpen = true;
  }

  session.connect();
  await recoverSharedFiles(session);

  const roomId = page.url.searchParams.get("room");
  const hostId = page.url.searchParams.get("host");
  const auto = page.url.searchParams.get("auto") ?? undefined;
  if (roomId && hostId !== appState.identity.peerId) {
    session.startRoomJoin(auto ? "auto" : "ask", auto);
  }
}

export function setupSessionEffects(
  session: SessionManager,
  options: {
    getRoom: () => string | undefined;
    getIsHost: () => boolean;
    getVisibilityState: () => DocumentVisibilityState;
  },
) {
  $effect(() => {
    if (options.getVisibilityState() === "visible") {
      void requestWakeLock();
      closeHostBackgroundNotify();
    } else if (
      options.getVisibilityState() === "hidden" &&
      options.getIsHost() &&
      options.getRoom()
    ) {
      notifyHostBackground();
    }
  });

  $effect(() => {
    options.getRoom();
    session.announce();
  });

  $effect(() => {
    session.setManualDownload(!appState.autoDownload);
  });

  $effect(() => {
    if (appState.roomJoinOpen && appState.connectedPeerId) {
      session.finishRoomJoinSuccess();
    }
  });

  $effect.pre(() => {
    if (appState.connectionModalOpen) lazyLoad.mark("connectionRequest");
    if (appState.unsupportedBrowserModalOpen) lazyLoad.mark("unsupportedBrowser");
    if (appState.shareModalOpen) lazyLoad.mark("shareLink");
    if (appState.shareNotifyModalOpen) lazyLoad.mark("shareNotify");
    if (appState.roomJoinOpen) lazyLoad.mark("roomJoin");
  });
}

export function teardownSessionPage() {
  void releaseWakeLock();
}

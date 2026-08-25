import { goto } from "$app/navigation";
import { page } from "$app/state";

import { deviceStore } from "#lib/stores/deviceStore.svelte.js";
import { lazyLoad } from "#lib/stores/lazyLoad.svelte.js";
import { peerStore } from "#lib/stores/peerStore.svelte.js";
import { toastStore } from "#lib/stores/toast.svelte.js";
import { transferStore } from "#lib/stores/transferStore.svelte.js";
import { uiStore } from "#lib/stores/uiStore.svelte.js";
import {
  closeHostBackgroundNotify,
  notifyHostBackground,
} from "#lib/utils/device/backgroundNotify.js";
import { releaseWakeLock, requestWakeLock } from "#lib/utils/device/wakelock.js";
import { feedback } from "#lib/utils/feedback.js";
import { createQueuedFile } from "#lib/utils/files/queue.js";
import { ensureServiceWorkerReady } from "#lib/utils/files/swDownload.js";
import { consumeSharedRecords } from "#lib/utils/files/webShare.js";
import type { SessionManager } from "#lib/utils/webrtc/SessionManager.js";

export async function applyAssignedCode(code: string) {
  const url = new URL("/share/", page.url.origin);
  url.searchParams.set("hostid", deviceStore.identity.peerId);
  url.searchParams.set("code", code);
  await goto(`${url.pathname}${url.search}`, { replace: true, reset: false });

  try {
    await navigator.clipboard.writeText(url.href);
    toastStore.showToast("Link copiado", "success");
  } catch {
    // ignore clipboard errors
  }
}

export async function leaveShare(session: SessionManager) {
  feedback.light();
  if (peerStore.connectedPeerId) session.peerSession.disconnectPeer();
  await goto("/", { reset: true });
  toastStore.showToast("Saiu", "info");
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
        session.queue.appendQueuedFiles(queued);
      }
    }

    if (hasFiles) {
      toastStore.showToast("Arquivo(s) adicionado(s) na fila", "success");
      session.queue.notifyQueueChanged();
    }
  } catch (e) {
    toastStore.showToast("Falha ao recuperar arquivos compartilhados", "error");
    console.error("Failed to recover shared files", e);
  }
}

export async function initSessionPage(session: SessionManager): Promise<string | null> {
  void requestWakeLock();

  const swAvailable = await ensureServiceWorkerReady();
  if (!swAvailable) {
    uiStore.unsupportedBrowserModalOpen = true;
  }

  session.connect();
  await recoverSharedFiles(session);

  const isHost = page.url.searchParams.get("hostid") === deviceStore.identity.peerId;
  const code = page.url.searchParams.get("code");
  if (code && !isHost) return session.codeJoin.join(code);
  return null;
}

export function setupSessionEffects(
  session: SessionManager,
  options: {
    getCode: () => string | undefined;
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
      options.getCode()
    ) {
      notifyHostBackground();
    }
  });

  $effect(() => {
    options.getCode();
    options.getIsHost();
    session.announce();
  });

  $effect(() => {
    session.peerSession.setManualDownload(!transferStore.autoDownload);
  });

  $effect(() => {
    if (uiStore.codeJoinOpen && peerStore.connectedPeerId) {
      session.codeJoin.finishSuccess();
    }
  });

  $effect.pre(() => {
    if (uiStore.unsupportedBrowserModalOpen) lazyLoad.mark("unsupportedBrowser");
    if (uiStore.codeJoinOpen) lazyLoad.mark("codeJoin");
  });
}

export function teardownSessionPage() {
  void releaseWakeLock();
}

<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import DeviceList from "$lib/components/device/DeviceList.svelte";
  import Files from "$lib/components/transfer/Files.svelte";
  import TransferProgress from "$lib/components/transfer/TransferProgress.svelte";
  import { appState } from "$lib/stores/appState.svelte";
  import { lazyLoad } from "$lib/stores/lazyLoad.svelte";
  import { toastStore } from "$lib/stores/toast.svelte";
  import {
    closeHostBackgroundNotify,
    ensureNotificationPermission,
    notifyHostBackground,
  } from "$lib/utils/device/backgroundNotify";
  import { releaseWakeLock, requestWakeLock } from "$lib/utils/device/wakelock";
  import { createQueuedFile } from "$lib/utils/files/queue";
  import { ensureServiceWorkerReady } from "$lib/utils/files/swDownload";
  import { consumeSharedRecords } from "$lib/utils/files/webShare";
  import vibrate from "$lib/utils/vibrate";
  import { SessionManager } from "$lib/utils/webrtc/SessionManager";
  import { registerSession, unregisterSession } from "$lib/utils/webrtc/sessionRegistry";
  import { onDestroy, onMount, tick } from "svelte";

  const room = $derived(page.url.searchParams.get("room") ?? undefined);
  const autoParam = $derived(page.url.searchParams.get("auto") ?? undefined);
  const isHost = $derived(page.url.searchParams.get("host") === appState.identity.peerId);
  const inRoom = $derived(!!room);
  const shareMode = $derived<"manual" | "auto" | null>(autoParam ? "auto" : room ? "manual" : null);
  const shareLink = $derived(inRoom ? page.url.href : null);

  const session = new SessionManager({
    getRoom: () => page.url.searchParams.get("room") ?? undefined,
    getRoomCode: () => page.url.searchParams.get("auto") ?? undefined,
  });
  registerSession(session);

  let visibilityState = $state(document.visibilityState);

  function generateRoomId() {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  }

  async function handleShareNotifyContinue() {
    const granted = await ensureNotificationPermission();
    if (granted) {
      appState.shareNotifyModalOpen = false;
      appState.shareModalOpen = true;
      return;
    }
    appState.shareNotifyDenied = true;
  }

  async function applyShareParams(mode: "manual" | "auto") {
    vibrate.light();

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

  function chooseManualShare() {
    return applyShareParams("manual");
  }

  function chooseAutoShare() {
    return applyShareParams("auto");
  }

  async function leaveRoom() {
    vibrate.light();
    if (!room) return;

    appState.shareModalOpen = false;
    await new Promise((resolve) => setTimeout(resolve, 300));

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

  function handleOnline() {
    session.wakeSignaling("online");
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      session.wakeSignaling("visibility");
    }
  }

  $effect(() => {
    if (visibilityState === "visible") {
      void requestWakeLock();
      closeHostBackgroundNotify();
    } else if (visibilityState === "hidden" && isHost && room) {
      notifyHostBackground();
    }
  });

  $effect(() => {
    room;
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

  onMount(async () => {
    void requestWakeLock();

    const swAvailable = await ensureServiceWorkerReady();
    if (!swAvailable) {
      appState.unsupportedBrowserModalOpen = true;
    }

    session.connect();

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

    const roomId = page.url.searchParams.get("room");
    const hostId = page.url.searchParams.get("host");
    const auto = page.url.searchParams.get("auto") ?? undefined;
    if (roomId && hostId !== appState.identity.peerId) {
      session.startRoomJoin(auto ? "auto" : "ask", auto);
    }
  });

  onDestroy(() => {
    void releaseWakeLock();
    session.destroy();
    unregisterSession(session);
  });
</script>

<div class="flex flex-col gap-6 py-6">
  <DeviceList
    peers={appState.displayPeers}
    {inRoom}
    pollingStopped={appState.roomJoinPhase === "failed"}
    connectingPeerId={appState.connectingPeerId}
    connectedPeerId={appState.connectedPeerId}
    connected={appState.connected}
    onConnect={(id) => session.handleConnect(id)}
    onDisconnect={() => session.disconnectPeer()} />

  <div class="flex flex-col gap-6">
    <TransferProgress
      transfers={appState.transfers}
      queue={appState.visibleQueue} />

    <Files
      autoDownload={appState.autoDownload}
      history={appState.transfers}
      queue={appState.visibleQueue}
      onadd={(files) => session.addFiles(files)}
      onremoveQueue={(id) => appState.removeFile(id)}
      onclearQueue={() => session.clearQueue()}
      onPull={(id) => session.handlePull(id)}
      onPullBatch={(ids, name) => session.handlePullBatch(ids, name)}
      onDeleteHistory={(id) => session.handleDeleteTransfer(id)} />
  </div>
</div>

{#if lazyLoad.has("connectionRequest")}
  {const ConnectionRequest = (await import("$lib/components/device/ConnectionRequest.svelte"))
    .default}
  <ConnectionRequest
    open={appState.connectionModalOpen}
    requester={appState.pendingRequest}
    onaccept={() => session.acceptPendingRequest()}
    ondeny={() => session.denyPendingRequest()} />
{/if}

{#if lazyLoad.has("unsupportedBrowser")}
  {const UnsupportedBrowserModal = (
    await import("$lib/components/modals/UnsupportedBrowserModal.svelte")
  ).default}
  <UnsupportedBrowserModal />
{/if}

{#if lazyLoad.has("shareNotify")}
  {const ShareNotifyPermissionModal = (
    await import("$lib/components/modals/ShareNotifyPermissionModal.svelte")
  ).default}
  <ShareNotifyPermissionModal
    open={appState.shareNotifyModalOpen}
    denied={appState.shareNotifyDenied}
    onClose={() => (appState.shareNotifyModalOpen = false)}
    onContinue={handleShareNotifyContinue} />
{/if}

{#if lazyLoad.has("shareLink")}
  {const ShareLinkModal = (await import("$lib/components/modals/ShareLinkModal.svelte")).default}
  <ShareLinkModal
    open={appState.shareModalOpen}
    {inRoom}
    mode={shareMode}
    link={shareLink}
    onSelectManual={chooseManualShare}
    onSelectAuto={chooseAutoShare}
    onLeaveRoom={leaveRoom}
    onClose={() => (appState.shareModalOpen = false)} />
{/if}

{#if lazyLoad.has("roomJoin")}
  {const RoomJoinModal = (await import("$lib/components/modals/RoomJoinModal.svelte")).default}
  <RoomJoinModal
    open={appState.roomJoinOpen}
    phase={appState.roomJoinPhase}
    peerName={appState.connectedPeerInfo?.displayName}
    onClose={() => session.cancelRoomJoin()} />
{/if}

<svelte:window ononline={handleOnline} />
<svelte:document
  bind:visibilityState
  onvisibilitychange={handleVisibilityChange} />

<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import DeviceList from "$lib/components/device/DeviceList.svelte";
  import YourDeviceCard from "$lib/components/device/YourDeviceCard.svelte";
  import Files from "$lib/components/transfer/Files.svelte";
  import TransferProgress from "$lib/components/transfer/TransferProgress.svelte";
  import { appState } from "$lib/stores/appState.svelte";
  import { lazyLoad } from "$lib/stores/lazyLoad.svelte";
  import { toastStore } from "$lib/stores/toast.svelte";
  import {
    closeAutoConnectBackgroundNotify,
    notifyAutoConnectBackground,
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

  const session = new SessionManager({
    getRoom: () => room,
  });
  registerSession(session);

  let visibilityState = $state(document.visibilityState);

  function generateRoomId() {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  }

  async function shareRoom() {
    vibrate.light();

    let roomId = room;
    if (!roomId) {
      roomId = generateRoomId();
      await goto(`?room=${roomId}`, { keepFocus: true, noScroll: true });
      await tick();
    }

    const url = new URL(page.url);
    url.searchParams.set("room", roomId);

    try {
      await navigator.clipboard.writeText(url.toString());
      toastStore.showToast("Link copiado", "success");
      session.announce();
    } catch {
      toastStore.showToast("Não foi possível copiar o link", "error");
    }
  }

  async function leaveRoom() {
    vibrate.light();
    if (!room) return;

    if (appState.connectedPeerId) session.disconnectPeer();

    const url = new URL(page.url);
    url.searchParams.delete("room");
    const target = url.search ? `${url.pathname}${url.search}` : url.pathname;
    await goto(target, { keepFocus: true, noScroll: true });
    await tick();
    session.announce();
    toastStore.showToast("Saiu da sala", "info");
  }

  function handleAutoKeyClick() {
    vibrate.light();
    session.handleAutoKeyClick();
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
      closeAutoConnectBackgroundNotify();
    } else if (visibilityState === "hidden" && appState.autoKey) {
      notifyAutoConnectBackground();
    }
  });

  $effect(() => {
    session.setManualDownload(!appState.autoDownload);
  });

  $effect.pre(() => {
    if (appState.connectionModalOpen) lazyLoad.mark("connectionRequest");
    if (appState.unsupportedBrowserModalOpen) lazyLoad.mark("unsupportedBrowser");
    if (appState.autoKey) lazyLoad.mark("autoKeyShare");
    if (appState.autoKeyNotifyModalOpen) lazyLoad.mark("autoKeyNotify");
    if (appState.enterKeyModalOpen) lazyLoad.mark("autoKeyEnter");
    if (appState.inRoomModalOpen) lazyLoad.mark("inRoom");
  });

  onMount(async () => {
    void requestWakeLock();

    const inRoom = !!room;
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

    if (inRoom) {
      appState.inRoomModalOpen = true;
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
    inRoom={!!room}
    hasAutoKey={!!appState.autoKey}
    connectingPeerId={appState.connectingPeerId}
    connectedPeerId={appState.connectedPeerId}
    connected={appState.connected}
    onConnect={(id) => session.handleConnect(id)}
    onDisconnect={() => session.disconnectPeer()}
    onRoomClick={() => (room ? leaveRoom() : shareRoom())}
    onAutoKeyClick={handleAutoKeyClick}
    onAutoConnect={(id) => session.handleAutoConnectClick(id)} />

  <div class="grid min-w-0 gap-6 lg:grid-cols-2">
    <div class="flex flex-col gap-4 lg:col-span-1">
      <YourDeviceCard
        bind:displayName={appState.displayName}
        handleDisplayNameBlur={() => session.handleDisplayNameBlur()} />
    </div>

    <div class="flex flex-col gap-4 lg:col-span-1">
      <TransferProgress
        bind:autoDownload={appState.autoDownload}
        connected={appState.connected}
        transfers={appState.transfers}
        queue={appState.visibleQueue} />
    </div>

    <div class="min-w-0 lg:col-span-2">
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

{#if lazyLoad.has("autoKeyNotify")}
  {const AutoKeyNotifyPermissionModal = (
    await import("$lib/components/modals/AutoKeyNotifyPermissionModal.svelte")
  ).default}
  <AutoKeyNotifyPermissionModal
    open={appState.autoKeyNotifyModalOpen}
    denied={appState.autoKeyNotifyDenied}
    onClose={() => session.handleAutoKeyNotifyClose()}
    onContinue={() => session.handleAutoKeyNotifyContinue()} />
{/if}

{#if lazyLoad.has("autoKeyShare") && appState.autoKey}
  {const AutoKeyShareModal = (await import("$lib/components/modals/AutoKeyShareModal.svelte"))
    .default}
  <AutoKeyShareModal
    open={appState.autoKeyModalOpen}
    autoKey={appState.autoKey}
    onClose={() => session.handleAutoKeyModalClose()}
    onCopy={() => session.copyAutoKey()}
    onRegenerate={() => session.regenerateAutoKey()} />
{/if}

{#if lazyLoad.has("autoKeyEnter")}
  {const AutoKeyEnterModal = (await import("$lib/components/modals/AutoKeyEnterModal.svelte"))
    .default}
  <AutoKeyEnterModal
    open={appState.enterKeyModalOpen}
    peer={appState.enterKeyPeer}
    onClose={() => session.handleEnterKeyModalClose()}
    onSubmit={(key) => session.handleEnterKeySubmit(key)}
    onNoKey={() => session.handleEnterKeyNoKey()} />
{/if}

{#if lazyLoad.has("inRoom")}
  {const InRoomModal = (await import("$lib/components/modals/InRoomModal.svelte")).default}
  <InRoomModal
    open={appState.inRoomModalOpen}
    onClose={() => (appState.inRoomModalOpen = false)} />
{/if}

<svelte:window ononline={handleOnline} />
<svelte:document
  bind:visibilityState
  onvisibilitychange={handleVisibilityChange} />

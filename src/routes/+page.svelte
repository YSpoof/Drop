<script lang="ts">
  import { page } from "$app/state";
  import DeviceList from "$lib/components/device/DeviceList.svelte";
  import Files from "$lib/components/transfer/Files.svelte";
  import TransferProgress from "$lib/components/transfer/TransferProgress.svelte";
  import { appState } from "$lib/stores/appState.svelte";
  import { lazyLoad } from "$lib/stores/lazyLoad.svelte";
  import { ensureNotificationPermission } from "$lib/utils/device/backgroundNotify";
  import {
    applyShareParams,
    initSessionPage,
    leaveRoom,
    setupSessionEffects,
    teardownSessionPage,
  } from "$lib/utils/sessionSetup.svelte";
  import {
    SessionManager,
    registerSession,
    unregisterSession,
  } from "$lib/utils/webrtc/SessionManager";
  import { onDestroy, onMount } from "svelte";

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

  async function handleShareNotifyContinue() {
    const granted = await ensureNotificationPermission();
    if (granted) {
      appState.shareNotifyModalOpen = false;
      appState.shareModalOpen = true;
      return;
    }
    appState.shareNotifyDenied = true;
  }

  setupSessionEffects(session, {
    getRoom: () => room,
    getIsHost: () => isHost,
    getVisibilityState: () => visibilityState,
  });

  onMount(() => initSessionPage(session));

  onDestroy(() => {
    teardownSessionPage();
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
    onSelectManual={() => applyShareParams(session, "manual", room)}
    onSelectAuto={() => applyShareParams(session, "auto", room)}
    onLeaveRoom={() => leaveRoom(session, room)}
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

<svelte:window ononline={() => session.wakeSignaling("online")} />
<svelte:document
  bind:visibilityState
  onvisibilitychange={() => {
    if (document.visibilityState === "visible") session.wakeSignaling("visibility");
  }} />

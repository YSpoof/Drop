<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { onDestroy, onMount } from "svelte";

  import PossessCodeModal from "#lib/components/modals/PossessCodeModal.svelte";
  import ShareStatus from "#lib/components/share/ShareStatus.svelte";
  import Files from "#lib/components/transfer/Files.svelte";
  import TransferProgress from "#lib/components/transfer/TransferProgress.svelte";
  import { queueService } from "#lib/runtime.js";
  import { deviceStore } from "#lib/stores/deviceStore.svelte.js";
  import { lazyLoad } from "#lib/stores/lazyLoad.svelte.js";
  import { peerStore } from "#lib/stores/peerStore.svelte.js";
  import { transferStore } from "#lib/stores/transferStore.svelte.js";
  import { uiStore } from "#lib/stores/uiStore.svelte.js";
  import {
    applyAssignedCode,
    initSessionPage,
    leaveShare,
    setupSessionEffects,
    teardownSessionPage,
  } from "#lib/utils/sessionSetup.svelte.js";
  import {
    SessionManager,
    registerSession,
    unregisterSession,
  } from "#lib/utils/webrtc/SessionManager.js";

  const hostid = $derived(page.url.searchParams.get("hostid") ?? undefined);
  const code = $derived(page.url.searchParams.get("code") ?? undefined);
  const isHost = $derived(hostid === deviceStore.identity.peerId);
  const shareLink = $derived(code ? page.url.href : undefined);

  let lookupError = $state<string | null>(null);
  let retryOpen = $state(false);

  const session = new SessionManager({
    getCode: () => code,
    getIsHost: () => isHost,
    onCodeAssigned: (assigned) => void applyAssignedCode(assigned),
    onJoinFailed: (message) => {
      lookupError = message;
      retryOpen = true;
    },
  });
  registerSession(session);

  let visibilityState = $state(document.visibilityState);

  setupSessionEffects(session, {
    getCode: () => code,
    getIsHost: () => isHost,
    getVisibilityState: () => visibilityState,
  });

  onMount(async () => {
    const err = await initSessionPage(session);
    if (err) {
      lookupError = err;
      retryOpen = true;
    }
  });
  onDestroy(() => {
    teardownSessionPage();
    session.destroy();
    unregisterSession(session);
  });

  let wasConnected = $state(false);
  $effect(() => {
    if (peerStore.connected) {
      wasConnected = true;
    } else if (wasConnected && !isHost) {
      wasConnected = false;
      void goto("/", { reset: true });
    }
  });
</script>

<div class="flex flex-col gap-6 py-6">
  <ShareStatus
    {isHost}
    connected={peerStore.connected}
    viaLan={peerStore.connectedViaLan}
    {code}
    link={shareLink}
    peerName={peerStore.connectedPeerInfo?.displayName}
    codeJoinPhase={peerStore.codeJoinPhase}
    onLeave={() => leaveShare(session)}
    onDisconnect={() => {
      session.peerSession.disconnectPeer();
      if (!isHost) void goto("/", { reset: true });
    }} />

  <div class="flex flex-col gap-6">
    <TransferProgress
      transfers={transferStore.transfers}
      queue={transferStore.visibleQueue} />

    <Files
      autoDownload={transferStore.autoDownload}
      history={transferStore.transfers}
      queue={transferStore.visibleQueue}
      onadd={(files: FileList | File[] | { file: File; path: string }[]) =>
        queueService.addFiles(files)}
      onremoveQueue={(id: string | string[]) => transferStore.removeFile(id)}
      onclearQueue={() => queueService.clearQueue()}
      onPull={(id: string) => queueService.handlePull(id)}
      onPullBatch={(ids: string[], name?: string) => queueService.handlePullBatch(ids, name)}
      onDeleteHistory={(id: string | string[]) => queueService.handleDeleteTransfer(id)} />
  </div>
</div>

<PossessCodeModal
  open={retryOpen}
  error={lookupError}
  closeLabel="Início"
  onClose={() => leaveShare(session)}
  onFound={async (next: string) => {
    lookupError = null;
    await goto(`/share/?code=${next}`, { replace: true, reset: false });
    const err = await session.codeJoin.join(next);
    lookupError = err;
    retryOpen = !!err;
    return err;
  }} />

{#if lazyLoad.has("codeJoin")}
  {const CodeJoinModal = (await import("#lib/components/modals/CodeJoinModal.svelte")).default}
  <CodeJoinModal
    open={uiStore.codeJoinOpen}
    phase={peerStore.codeJoinPhase}
    peerName={peerStore.connectedPeerInfo?.displayName}
    onClose={() => session.codeJoin.cancel()} />
{/if}

{#if lazyLoad.has("unsupportedBrowser")}
  {const UnsupportedBrowserModal = (
    await import("#lib/components/modals/UnsupportedBrowserModal.svelte")
  ).default}
  <UnsupportedBrowserModal />
{/if}

<svelte:window ononline={() => session.wakeSignaling("online")} />
<svelte:document
  bind:visibilityState
  onvisibilitychange={() => {
    if (document.visibilityState === "visible") session.wakeSignaling("visibility");
  }} />

<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import LightningBoltIcon from "~icons/mdi/lightning-bolt";
  import NumericIcon from "~icons/mdi/numeric";

  import PossessCodeModal from "#lib/components/modals/PossessCodeModal.svelte";
  import { notifications } from "#lib/runtime.js";
  import { deviceStore } from "#lib/stores/deviceStore.svelte.js";
  import { lazyLoad } from "#lib/stores/lazyLoad.svelte.js";
  import { uiStore } from "#lib/stores/uiStore.svelte.js";
  import { feedback } from "#lib/utils/feedback.js";
  import { hasSharedRecords } from "#lib/utils/files/webShare.js";
  let possessOpen = $state(false);

  function gotoHostShare() {
    goto("/share/?hostid=" + deviceStore.identity.peerId);
  }

  function openGenerateGate() {
    if (!notifications.needsPermissionForHostShare) {
      gotoHostShare();
      return;
    }

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      gotoHostShare();
      return;
    }

    uiStore.shareNotifyDenied =
      typeof Notification === "undefined" || Notification.permission === "denied";
    lazyLoad.mark("shareNotify");
    uiStore.shareNotifyModalOpen = true;
  }

  function handleGenerateClick() {
    feedback.light();
    openGenerateGate();
  }

  function handlePossessClick() {
    feedback.light();
    possessOpen = true;
  }

  async function handleShareNotifyContinue() {
    const granted = await notifications.ensurePermission();
    if (granted) {
      uiStore.shareNotifyModalOpen = false;
      gotoHostShare();
      return;
    }
    uiStore.shareNotifyDenied = true;
  }

  onMount(async () => {
    if (await hasSharedRecords()) openGenerateGate();
  });
</script>

<div class="flex min-h-[60vh] items-center justify-center py-6">
  <div class="flex w-full max-w-2xl flex-col gap-3 sm:flex-row">
    <button
      type="button"
      class="card bg-base-100 dark:bg-base-300 hover:border-primary flex-1 border-2 border-transparent text-left shadow-sm transition-colors"
      onclick={handleGenerateClick}>
      <div class="card-body gap-2 p-6">
        <div class="flex items-center gap-2">
          <LightningBoltIcon class="text-primary text-2xl" />
          <h2 class="text-lg font-semibold">Gerar um código</h2>
        </div>
        <p class="text-base-content/70 text-sm">
          Crie uma sessão, copie o link e envie para outra pessoa.
        </p>
      </div>
    </button>

    <button
      type="button"
      class="card bg-base-100 dark:bg-base-300 hover:border-primary flex-1 border-2 border-transparent text-left shadow-sm transition-colors"
      onclick={handlePossessClick}>
      <div class="card-body gap-2 p-6">
        <div class="flex items-center gap-2">
          <NumericIcon class="text-primary text-2xl" />
          <h2 class="text-lg font-semibold">Possuo um código</h2>
        </div>
        <p class="text-base-content/70 text-sm">Entre com o PIN de 6 dígitos para se conectar.</p>
      </div>
    </button>
  </div>
</div>

<PossessCodeModal
  open={possessOpen}
  onClose={() => (possessOpen = false)}
  onFound={(code: string) => {
    possessOpen = false;
    goto("/share/?code=" + code);
  }} />

{#if lazyLoad.has("shareNotify")}
  {const ShareNotifyPermissionModal = (
    await import("#lib/components/modals/ShareNotifyPermissionModal.svelte")
  ).default}
  <ShareNotifyPermissionModal
    open={uiStore.shareNotifyModalOpen}
    denied={uiStore.shareNotifyDenied}
    onClose={() => (uiStore.shareNotifyModalOpen = false)}
    onContinue={handleShareNotifyContinue} />
{/if}

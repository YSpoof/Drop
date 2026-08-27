<script lang="ts">
  import { onMount } from "svelte";

  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import { receiveFolder } from "#lib/runtime.js";
  import { deviceStore } from "#lib/stores/deviceStore.svelte.js";
  import { peerStore } from "#lib/stores/peerStore.svelte.js";
  import { transferStore } from "#lib/stores/transferStore.svelte.js";
  import { uiStore } from "#lib/stores/uiStore.svelte.js";
  import { saveAutoDownload, saveReceiveFolderPath } from "#lib/utils/files/prefs.js";

  let defaultReceiveFolder = $state("Downloads");
  const displayPath = $derived(transferStore.receiveFolderPath || defaultReceiveFolder);

  $effect(() => {
    saveAutoDownload(transferStore.autoDownload);
  });

  onMount(() => {
    if (!receiveFolder.canPick) return;
    receiveFolder
      .defaultPath()
      .then((path) => {
        if (path) defaultReceiveFolder = path;
      })
      .catch(() => {});
  });

  async function chooseReceiveFolder() {
    const selected = await receiveFolder.pick(transferStore.receiveFolderPath || undefined);
    if (!selected) return;
    transferStore.receiveFolderPath = selected;
    await saveReceiveFolderPath(selected);
  }
</script>

<GenericModal
  open={uiStore.settingsModalOpen}
  title="Configurações"
  onClose={() => (uiStore.settingsModalOpen = false)}
  modalClass="w-full md:max-w-sm">
  <div class="flex flex-col gap-4">
    <label class="floating-label">
      <input
        type="text"
        placeholder="Nome de exibição"
        class="input w-full"
        bind:value={deviceStore.displayName}
        onblur={() => deviceStore.handleDisplayNameBlur()} />
      <span>Nome de exibição</span>
    </label>

    <div class="flex items-center justify-between">
      <span class="text-sm font-medium">Download automático</span>
      <input
        type="checkbox"
        class="toggle toggle-primary"
        bind:checked={transferStore.autoDownload}
        disabled={peerStore.connected} />
    </div>

    {#if receiveFolder.canPick}
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0 flex-1">
          <span class="text-sm font-medium">Pasta para downloads</span>
          <p
            class="text-base-content/70 truncate text-xs"
            title={displayPath}>
            {displayPath}
          </p>
        </div>
        <button
          class="btn btn-sm"
          disabled={peerStore.connected}
          onclick={chooseReceiveFolder}>
          Escolher pasta
        </button>
      </div>
    {/if}
  </div>

  {#snippet modalActions()}
    <button
      class="btn btn-primary"
      onclick={() => (uiStore.settingsModalOpen = false)}>
      Fechar
    </button>
  {/snippet}
</GenericModal>

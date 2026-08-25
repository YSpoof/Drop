<script lang="ts">
  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import { deviceStore } from "#lib/stores/deviceStore.svelte.js";
  import { peerStore } from "#lib/stores/peerStore.svelte.js";
  import { transferStore } from "#lib/stores/transferStore.svelte.js";
  import { uiStore } from "#lib/stores/uiStore.svelte.js";
  import { saveAutoDownload } from "#lib/utils/files/prefs.js";

  $effect(() => {
    saveAutoDownload(transferStore.autoDownload);
  });
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
  </div>

  {#snippet modalActions()}
    <button
      class="btn btn-primary"
      onclick={() => (uiStore.settingsModalOpen = false)}>
      Fechar
    </button>
  {/snippet}
</GenericModal>

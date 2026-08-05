<script lang="ts">
  import GenericModal from "$lib/components/ui/GenericModal.svelte";
  import { appState } from "$lib/stores/appState.svelte";
  import { saveAutoDownload } from "$lib/utils/files/prefs";

  $effect(() => {
    saveAutoDownload(appState.autoDownload);
  });
</script>

<GenericModal
  open={appState.settingsModalOpen}
  title="Configurações"
  onClose={() => (appState.settingsModalOpen = false)}
  modalClass="w-full md:max-w-sm">
  <div class="flex flex-col gap-4">
    <label class="floating-label">
      <input
        type="text"
        placeholder="Nome de exibição"
        class="input w-full"
        bind:value={appState.displayName}
        onblur={() => appState.handleDisplayNameBlur()} />
      <span>Nome de exibição</span>
    </label>

    <div class="flex items-center justify-between">
      <span class="text-sm font-medium">Download automático</span>
      <input
        type="checkbox"
        class="toggle toggle-primary"
        bind:checked={appState.autoDownload}
        disabled={appState.connected} />
    </div>
  </div>

  {#snippet modalActions()}
    <button
      class="btn btn-primary"
      onclick={() => (appState.settingsModalOpen = false)}>
      Fechar
    </button>
  {/snippet}
</GenericModal>

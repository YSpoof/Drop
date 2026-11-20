<script lang="ts">
  import DevicePrefsFields from "#lib/components/settings/DevicePrefsFields.svelte";
  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import { uiStore } from "#lib/stores/uiStore.svelte.js";
</script>

<GenericModal
  open={uiStore.settingsModalOpen}
  title="Configurações"
  onClose={() => (uiStore.settingsModalOpen = false)}
  modalClass="w-full md:max-w-sm">
  <DevicePrefsFields class="flex flex-col gap-4" />

  {#snippet modalActions()}
    <button
      class="btn btn-primary"
      onclick={() => (uiStore.settingsModalOpen = false)}>
      Fechar
    </button>
  {/snippet}
</GenericModal>

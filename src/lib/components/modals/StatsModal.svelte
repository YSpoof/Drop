<script lang="ts">
  import GenericModal from "$lib/components/ui/GenericModal.svelte";
  import { appState } from "$lib/stores/appState.svelte";
  import { toastStore } from "$lib/stores/toast.svelte";
  import { formatBytes } from "$lib/utils/files/format";
  import ProgressDownloadIcon from "~icons/mdi/progress-download";
  import ProgressUploadIcon from "~icons/mdi/progress-upload";
</script>

<GenericModal
  open={appState.statsModalOpen}
  title="Estatísticas"
  onClose={() => (appState.statsModalOpen = false)}
  modalClass="w-full md:max-w-sm">
  <div class="card bg-base-100 dark:bg-base-300 shadow-sm">
    <div class="card-body gap-3">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <ProgressUploadIcon
            class="text-lg"
            aria-hidden="true" />
          <span>Enviado</span>
        </div>
        <span class="font-medium">{formatBytes(appState.transferStats.uploadBytes)}</span>
      </div>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <ProgressDownloadIcon
            class="text-lg"
            aria-hidden="true" />
          <span>Recebido</span>
        </div>
        <span class="font-medium">{formatBytes(appState.transferStats.downloadBytes)}</span>
      </div>
      <div class="flex items-center justify-between gap-4">
        <span>Total</span>
        <span class="font-medium">
          {formatBytes(appState.transferStats.uploadBytes + appState.transferStats.downloadBytes)}
        </span>
      </div>
    </div>
  </div>
  {#snippet modalActions()}
    <button
      class="btn btn-error btn-soft"
      onclick={() => {
        if (confirm("Zerar todas as estatísticas?")) {
          appState.resetTransferStats();
          appState.statsModalOpen = false;
          toastStore.showToast("Estatísticas zeradas com sucesso", "success");
        }
      }}>
      Zerar
    </button>
    <button
      class="btn btn-primary"
      onclick={() => (appState.statsModalOpen = false)}>Fechar</button>
  {/snippet}
</GenericModal>

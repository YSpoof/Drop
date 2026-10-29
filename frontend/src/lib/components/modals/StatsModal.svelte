<script lang="ts">
  import ProgressDownloadIcon from "~icons/mdi/progress-download";
  import ProgressTotalIcon from "~icons/mdi/progress-star";
  import ProgressUploadIcon from "~icons/mdi/progress-upload";

  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import { toastStore } from "#lib/stores/toast.svelte.js";
  import { transferStore } from "#lib/stores/transferStore.svelte.js";
  import { uiStore } from "#lib/stores/uiStore.svelte.js";
  import { formatBytes } from "#lib/utils/files/format.js";

  function formatFileCount(count: number): string {
    return `${count} ${count === 1 ? "arquivo" : "arquivos"}`;
  }
</script>

<GenericModal
  open={uiStore.statsModalOpen}
  title="Estatísticas Gerais"
  onClose={() => (uiStore.statsModalOpen = false)}
  modalClass="w-full md:max-w-sm">
  <div class="card bg-base-100 dark:bg-base-300 shadow-sm">
    <div class="card-body gap-3">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <ProgressUploadIcon
            class="text-success text-lg"
            aria-hidden="true" />
          <span>Enviado</span>
        </div>
        {const fileCount = $derived(formatFileCount(transferStore.transferStats.uploadFiles))}
        {const uploadBytes = $derived(formatBytes(transferStore.transferStats.uploadBytes))}
        <span class="font-medium">
          {fileCount} - {uploadBytes}
        </span>
      </div>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <ProgressDownloadIcon
            class="text-warning text-lg"
            aria-hidden="true" />
          <span>Recebido</span>
        </div>
        {const downloadBytes = $derived(formatBytes(transferStore.transferStats.downloadBytes))}
        {const downloadFileCount = $derived(
          formatFileCount(transferStore.transferStats.downloadFiles),
        )}
        <span class="font-medium">
          {downloadFileCount} - {downloadBytes}
        </span>
      </div>
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <ProgressTotalIcon
            class="text-accent text-lg"
            aria-hidden="true" />
          <span>Total</span>
        </div>
        {const totalBytes = $derived(
          formatBytes(
            transferStore.transferStats.uploadBytes + transferStore.transferStats.downloadBytes,
          ),
        )}
        {const totalFileCount = $derived(
          formatFileCount(
            transferStore.transferStats.uploadFiles + transferStore.transferStats.downloadFiles,
          ),
        )}
        <span class="font-medium">
          {totalFileCount} - {totalBytes}
        </span>
      </div>
    </div>
  </div>
  {#snippet modalActions()}
    <button
      class="btn btn-error btn-soft"
      onclick={() => {
        if (confirm("Zerar todas as estatísticas?")) {
          transferStore.resetTransferStats();
          uiStore.statsModalOpen = false;
          toastStore.showToast("Estatísticas zeradas com sucesso", "success");
        }
      }}>
      Zerar
    </button>
    <button
      class="btn btn-primary"
      onclick={() => (uiStore.statsModalOpen = false)}>Fechar</button>
  {/snippet}
</GenericModal>

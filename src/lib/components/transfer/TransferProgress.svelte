<script lang="ts">
  import { formatBytes } from "$lib/utils/files/format";
  import { saveAutoDownload } from "$lib/utils/files/prefs";
  import type { QueuedFile } from "$lib/utils/files/queue";
  import type { TransferItem } from "$lib/utils/files/transferTypes";
  import ProgressDownloadIcon from "~icons/mdi/progress-download";
  import ProgressUploadIcon from "~icons/mdi/progress-upload";

  interface Props {
    autoDownload?: boolean;
    connected?: boolean;
    transfers: TransferItem[];
    queue: QueuedFile[];
  }

  let { autoDownload = $bindable(true), connected = false, transfers, queue }: Props = $props();

  $effect(() => {
    saveAutoDownload(autoDownload);
  });

  const transferIds = $derived(new Set(transfers.map((t) => t.id)));
  const pendingQueueBytes = $derived(
    queue
      .filter((item) => !transferIds.has(item.id))
      .reduce((sum, item) => sum + item.file.size, 0),
  );
  const totalBytes = $derived(
    transfers.reduce((sum, item) => sum + item.size, 0) + pendingQueueBytes,
  );
  const transferredBytes = $derived(
    transfers.reduce((sum, item) => sum + item.bytesTransferred, 0),
  );
  const uploadTransferredBytes = $derived(
    transfers
      .filter((item) => item.direction === "sent")
      .reduce((sum, item) => sum + item.bytesTransferred, 0),
  );
  const downloadTransferredBytes = $derived(
    transfers
      .filter((item) => item.direction === "received")
      .reduce((sum, item) => sum + item.bytesTransferred, 0),
  );
  const totalPercent = $derived(
    totalBytes > 0 ? Math.min(100, (transferredBytes / totalBytes) * 100) : 0,
  );
  const hasActiveUpload = $derived(
    transfers.some((item) => item.direction === "sent" && item.status === "in-progress"),
  );
  const hasActiveDownload = $derived(
    transfers.some((item) => item.direction === "received" && item.status === "in-progress"),
  );

  let uploadSpeedBytesPerSec = $state(0);
  let downloadSpeedBytesPerSec = $state(0);
  let prevSnapshot = { uploadBytes: 0, downloadBytes: 0, time: 0 };

  $effect(() => {
    const uploadBytes = uploadTransferredBytes;
    const downloadBytes = downloadTransferredBytes;
    const now = performance.now();

    if (prevSnapshot.time > 0) {
      const dt = (now - prevSnapshot.time) / 1000;
      if (dt >= 0.25) {
        const uploadDelta = uploadBytes - prevSnapshot.uploadBytes;
        const downloadDelta = downloadBytes - prevSnapshot.downloadBytes;
        uploadSpeedBytesPerSec = uploadDelta > 0 ? uploadDelta / dt : 0;
        downloadSpeedBytesPerSec = downloadDelta > 0 ? downloadDelta / dt : 0;
        prevSnapshot = { uploadBytes, downloadBytes, time: now };
      }
    } else {
      prevSnapshot = { uploadBytes, downloadBytes, time: now };
    }
  });

  function formatSpeed(bytesPerSec: number): string {
    if (bytesPerSec <= 0) return "0 B/s";
    return `${formatBytes(bytesPerSec)}/s`;
  }
</script>

<section class="card bg-base-100 dark:bg-base-300 min-w-0 flex-1 overflow-hidden shadow-sm">
  <div class="card-body min-w-0 gap-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 class="text-lg font-semibold">Transferência</h2>
      <div class="flex items-center gap-1 sm:gap-3">
        <span class="text-sm font-bold">Download automático:</span>
        <input
          type="checkbox"
          class="toggle toggle-primary"
          bind:checked={autoDownload}
          disabled={connected} />
      </div>
    </div>

    {#if totalBytes > 0}
      <div class="space-y-3">
        <div class="space-y-1">
          <div class="flex justify-between text-sm">
            <span class="text-base-content/70">Total</span>
            <span class="text-base-content/60">
              {formatBytes(transferredBytes)} / {formatBytes(totalBytes)}
            </span>
          </div>
          <progress
            class="progress progress-primary w-full"
            value={totalPercent}
            max="100"></progress>
        </div>

        <div class="flex justify-between text-sm">
          <div class="flex items-center gap-2">
            <div
              class="tooltip"
              data-tip="Velocidade de envio">
              <ProgressUploadIcon
                class="text-base"
                aria-hidden="true" />
            </div>
            <span class="font-medium">
              {hasActiveUpload ? formatSpeed(uploadSpeedBytesPerSec) : "—"}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <div
              class="tooltip"
              data-tip="Velocidade de recebimento">
              <ProgressDownloadIcon
                class="text-base"
                aria-hidden="true" />
            </div>
            <span class="font-medium">
              {hasActiveDownload ? formatSpeed(downloadSpeedBytesPerSec) : "—"}
            </span>
          </div>
        </div>
      </div>
    {:else}
      <p class="text-base-content/60 text-sm">Nenhuma transferência em andamento.</p>
    {/if}
  </div>
</section>

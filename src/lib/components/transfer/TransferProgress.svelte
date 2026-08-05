<script lang="ts">
  import { formatBytes } from "$lib/utils/files/format";
  import type { QueuedFile } from "$lib/utils/files/queue";
  import type { TransferItem } from "$lib/utils/files/transferTypes";
  import ProgressDownloadIcon from "~icons/mdi/progress-download";
  import ProgressUploadIcon from "~icons/mdi/progress-upload";

  interface Props {
    transfers: TransferItem[];
    queue: QueuedFile[];
  }

  let { transfers, queue }: Props = $props();

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
  const sentFiles = $derived(transfers.filter((t) => t.direction === "sent"));
  const sentCompleted = $derived(sentFiles.filter((t) => t.status === "completed").length);
  const sentTotal = $derived(sentFiles.length + queue.filter((q) => !transferIds.has(q.id)).length);
  const receivedFiles = $derived(transfers.filter((t) => t.direction === "received"));
  const receivedCompleted = $derived(receivedFiles.filter((t) => t.status === "completed").length);
  const receivedTotal = $derived(receivedFiles.length);

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
    <h2 class="text-lg font-semibold">Transferência</h2>

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
              class="tooltip tooltip-right"
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
              class="tooltip tooltip-left"
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

        <div class="text-base-content/70 flex justify-between text-sm">
          <span>{sentCompleted}/{sentTotal} enviados</span>
          <span>{receivedCompleted}/{receivedTotal} recebidos</span>
        </div>
      </div>
    {:else}
      <p class="text-base-content/60 text-sm">Nenhuma transferência em andamento.</p>
    {/if}
  </div>
</section>

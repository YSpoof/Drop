<script lang="ts">
  import { flip } from "svelte/animate";
  import { fade } from "svelte/transition";
  import AlertOctagon from "~icons/mdi/alert-octagon-outline";
  import AlertTriangle from "~icons/mdi/alert-outline";
  import CheckCircle from "~icons/mdi/check-circle-outline";
  import Close from "~icons/mdi/close";
  import Information from "~icons/mdi/information-outline";

  import ToastProgressBar from "#lib/components/ui/ToastProgressBar.svelte";
  import { toastStore } from "#lib/stores/toast.svelte.js";
  import type { Toast } from "#lib/types.js";
  import { feedback } from "#lib/utils/feedback.js";

  const toastMeta: Record<
    Toast["type"],
    { icon: typeof Close; class: string; progressClass: string }
  > = {
    info: { icon: Information, class: "alert-info", progressClass: "bg-info-content/90" },
    success: { icon: CheckCircle, class: "alert-success", progressClass: "bg-success-content/90" },
    warning: {
      icon: AlertTriangle,
      class: "alert-warning",
      progressClass: "bg-warning-content/90",
    },
    error: { icon: AlertOctagon, class: "alert-error", progressClass: "bg-error-content/90" },
  };

  const handleToastComplete = (toast: Toast) => {
    toastStore.removeToast(toast.id);
  };

  const handleRemoveToast = (toast: Toast) => {
    feedback.light();
    toastStore.removeToast(toast.id);
  };
</script>

<output
  class="toast toast-top toast-center top-20! z-50"
  aria-live="polite">
  {#each toastStore.visibleToasts as toast (toast.id)}
    {const meta = toastMeta[toast.type]}
    {const Icon = meta.icon}
    <div
      class={`alert ${meta.class} relative overflow-hidden`}
      role="status"
      animate:flip
      out:fade={{ duration: 200 }}>
      <Icon class="shrink-0 text-2xl" />
      <span>{toast.message}</span>
      <button
        class="btn btn-xs btn-ghost btn-circle gelatin"
        onclick={() => {
          handleRemoveToast(toast);
        }}
        aria-label="Fechar notificação">
        <Close class="text-xl" />
      </button>

      <ToastProgressBar
        duration={toast.duration}
        progressClass={meta.progressClass}
        onComplete={() => handleToastComplete(toast)} />
    </div>
  {/each}
</output>

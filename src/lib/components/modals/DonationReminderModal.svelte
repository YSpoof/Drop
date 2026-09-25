<script lang="ts">
  import CheckCircleIcon from "~icons/mdi/check-circle";
  import ContentCopyIcon from "~icons/mdi/content-copy";

  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import { clipboard } from "#lib/runtime.js";
  import { siteData } from "#lib/siteData.js";

  interface Props {
    open: boolean;
    onDismiss: () => void;
  }

  let { open, onDismiss }: Props = $props();

  let copied = $state(false);

  async function copyPixKey() {
    try {
      await clipboard.writeText(siteData.donationPixKey);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2500);
    } catch {
      // ignore
    }
  }

  function dismiss() {
    if (!open) return;
    onDismiss();
  }
</script>

<GenericModal
  {open}
  title="Gostou do Drop?"
  onClose={dismiss}>
  <div class="flex flex-col gap-3">
    <p class="text-base-content/70 text-sm text-balance">
      O Drop é gratuito. Um PIX ajuda a manter o projeto.
    </p>
    <p class="text-base-content/60 text-sm">Chave PIX aleatória, toque para copiar:</p>
    <button
      type="button"
      class="btn btn-sm justify-between font-mono"
      class:btn-success={copied}
      onclick={copyPixKey}>
      <span class="truncate">{siteData.donationPixKey}</span>
      {#if copied}
        <CheckCircleIcon class="text-base" />
      {:else}
        <ContentCopyIcon class="text-base" />
      {/if}
    </button>
  </div>

  {#snippet modalActions()}
    <button
      type="button"
      class="btn btn-primary"
      onclick={dismiss}>Fechar</button>
  {/snippet}
</GenericModal>

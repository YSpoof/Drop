<script lang="ts">
  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import PixKeyButton from "#lib/components/ui/PixKeyButton.svelte";

  interface Props {
    open: boolean;
    onDismiss: () => void;
  }

  let { open, onDismiss }: Props = $props();

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
    <PixKeyButton />
  </div>

  {#snippet modalActions()}
    <button
      type="button"
      class="btn btn-primary"
      onclick={dismiss}>Fechar</button>
  {/snippet}
</GenericModal>

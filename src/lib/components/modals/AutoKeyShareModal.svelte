<script lang="ts">
  import GenericModal from "$lib/components/ui/GenericModal.svelte";
  import vibrate from "$lib/utils/vibrate";
  import AlertIcon from "~icons/mdi/alert-outline";

  interface Props {
    open: boolean;
    autoKey: string;
    onClose: () => void;
    onCopy: () => void | Promise<void>;
  }

  let { open, autoKey, onClose, onCopy }: Props = $props();

  let cantClose = $state(true);

  async function handleCopyAndClose() {
    vibrate.light();
    cantClose = false;
    await onCopy();
    onClose();
  }
</script>

<GenericModal
  {open}
  {cantClose}
  title="Chave de auto-conexão"
  {onClose}>
  <div
    role="alert"
    class="alert alert-warning alert-vertical sm:alert-horizontal">
    <AlertIcon class="text-2xl" />
    <p class="text-balance">
      Quem tiver essa chave pode se conectar automaticamente sem sua aprovação.
    </p>
  </div>

  <div class="mt-4 flex items-center justify-center">
    <code class="bg-base-200 rounded-lg px-4 py-2 font-mono text-2xl tracking-widest">
      {autoKey}
    </code>
  </div>

  {#snippet modalActions()}
    <button
      class="btn btn-primary"
      onclick={handleCopyAndClose}>
      Copiar e fechar
    </button>
  {/snippet}
</GenericModal>

<script lang="ts">
  import GenericModal from "$lib/components/ui/GenericModal.svelte";
  import vibrate from "$lib/utils/vibrate";
  import LinkIcon from "~icons/mdi/link-variant";

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  let { open, onClose }: Props = $props();

  const handleClose = () => {
    vibrate.light();
    onClose();
  };
</script>

<GenericModal
  {open}
  title="Você entrou em uma sala"
  {onClose}>
  <div
    role="alert"
    class="alert alert-soft alert-info alert-vertical sm:alert-horizontal">
    <LinkIcon class="text-2xl" />
    <p class="text-balance">Aguarde a chegada de outros usuários ou peça outro link de acesso.</p>
  </div>

  {#snippet modalActions()}
    <button
      class="btn btn-primary"
      onclick={handleClose}>
      Entendido
    </button>
  {/snippet}
</GenericModal>

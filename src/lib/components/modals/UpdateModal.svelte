<script lang="ts">
  import GenericModal from "#lib/components/ui/GenericModal.svelte";

  interface Props {
    open: boolean;
  }

  let { open }: Props = $props();
</script>

<GenericModal
  {open}
  cantClose
  title="Nova versão disponível">
  <p>O Drop foi atualizado, por favor, recarregue a página!</p>
  {#snippet modalActions()}
    <button
      class="btn btn-primary"
      onclick={() => globalThis.location.reload()}>Recarregar</button>
  {/snippet}
</GenericModal>

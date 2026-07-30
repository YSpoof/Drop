<script lang="ts">
  import GenericModal from "$lib/components/ui/GenericModal.svelte";
  import vibrate from "$lib/utils/vibrate";

  interface Props {
    open: boolean;
    denied: boolean;
    onClose: () => void;
    onContinue: () => void | Promise<void>;
  }

  let { open, denied, onClose, onContinue }: Props = $props();

  function handleClose() {
    vibrate.light();
    onClose();
  }

  async function handleContinue() {
    vibrate.light();
    await onContinue();
  }
</script>

<GenericModal
  {open}
  title={denied ? "Notificações bloqueadas" : "Notificações necessárias"}
  onClose={handleClose}>
  {#if denied}
    <p class="text-base-content/80 text-sm">
      Sem permissão de notificações o compartilhamento de link não pode ser ativado.
    </p>
    <p class="text-base-content/70 mt-3 text-sm">
      Se o navegador bloqueou o pedido, ative as notificações nas configurações do site e tente
      novamente.
    </p>
  {:else}
    <p class="text-base-content/80 text-sm">
      O compartilhamento de link avisa você quando o app fica em segundo plano. É preciso permitir
      notificações para continuar.
    </p>
  {/if}

  {#snippet modalActions()}
    {#if denied}
      <button
        type="button"
        class="btn btn-primary"
        onclick={handleClose}>
        Fechar
      </button>
    {:else}
      <button
        type="button"
        class="btn"
        onclick={handleClose}>
        Cancelar
      </button>
      <button
        type="button"
        class="btn btn-primary"
        onclick={handleContinue}>
        Continuar
      </button>
    {/if}
  {/snippet}
</GenericModal>

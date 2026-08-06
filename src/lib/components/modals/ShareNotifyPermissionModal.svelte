<script lang="ts">
  import GenericModal from "$lib/components/ui/GenericModal.svelte";
  import { feedback } from "$lib/utils/feedback";

  interface Props {
    open: boolean;
    denied: boolean;
    onClose: () => void;
    onContinue: () => void | Promise<void>;
  }

  let { open, denied, onClose, onContinue }: Props = $props();

  function handleClose() {
    feedback.light();
    onClose();
  }

  async function handleContinue() {
    feedback.light();
    await onContinue();
  }
</script>

<GenericModal
  {open}
  title={denied ? "Notificações bloqueadas" : "Notificações necessárias"}
  onClose={handleClose}>
  {#if denied}
    <p class="text-base-content/80 text-sm">
      Sem permissão de notificações o compartilhamento remoto não pode ser ativado.
    </p>
    <p class="text-base-content/70 mt-3 text-sm">
      Se o navegador bloqueou o pedido, ative as notificações nas configurações do site e tente
      novamente.
    </p>
  {:else}
    <p class="text-base-content/80 text-sm">
      No modo de compartilhamento remoto, avisamos você quando o app fica em segundo plano. O que
      irá causar problemas de conexão.
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

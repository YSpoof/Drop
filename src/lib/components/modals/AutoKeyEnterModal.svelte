<script lang="ts">
  import GenericModal from "$lib/components/ui/GenericModal.svelte";
  import type { PeerInfo } from "$lib/utils/signaling/types";
  import vibrate from "$lib/utils/vibrate";

  interface Props {
    open: boolean;
    peer: PeerInfo | null;
    onClose: () => void;
    onSubmit: (key: string) => void;
    onNoKey?: () => void;
  }

  let { open, peer, onClose, onSubmit, onNoKey }: Props = $props();

  let keyInput = $state("");

  const canSubmit = $derived(/^\d{6}$/.test(keyInput));

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (!canSubmit) return;
    vibrate.light();
    onSubmit(keyInput);
    keyInput = "";
  }

  function handleClose() {
    vibrate.light();
    keyInput = "";
    onClose();
  }

  function handleNoKey() {
    vibrate.light();
    keyInput = "";
    onNoKey?.();
    onClose();
  }
</script>

<GenericModal
  {open}
  title="Conectar com chave"
  onClose={handleClose}>
  <p class="text-base-content/80 text-sm">
    Digite a chave de auto-conexão de
    <span class="font-semibold">{peer?.displayName}</span>
    para conectar automaticamente.
  </p>

  <form class="mt-4 flex justify-center">
    <label class="otp otp-primary">
      <span></span>
      <span></span>
      <span></span>
      <span></span>
      <span></span>
      <span></span>
      <input
        type="text"
        autocomplete="one-time-code"
        inputmode="numeric"
        maxlength="6"
        pattern="[0-9]{6}"
        required
        bind:value={keyInput} />
    </label>
  </form>
  {#snippet modalActions()}
    <button
      type="button"
      class="btn"
      onclick={handleClose}>
      Cancelar
    </button>
    <button
      type="button"
      class="btn btn-ghost"
      onclick={handleNoKey}>
      Solicitar conexão
    </button>
    <button
      type="button"
      onclick={handleSubmit}
      class="btn btn-primary"
      disabled={!canSubmit}>
      Usar a chave
    </button>
  {/snippet}
</GenericModal>

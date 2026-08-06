<script lang="ts">
  import GenericModal from "$lib/components/ui/GenericModal.svelte";
  import type { PeerInfo } from "$lib/utils/signaling/types";
  import { feedback } from "$lib/utils/feedback";

  interface Props {
    open: boolean;
    requester: PeerInfo | null;
    onaccept: () => void;
    ondeny: () => void;
  }

  let { open, requester, onaccept, ondeny }: Props = $props();

  const COUNTDOWN_SECONDS = 20;
  let secondsLeft = $state(COUNTDOWN_SECONDS);

  $effect(() => {
    if (requester) {
      feedback.warning();
    }
  });

  $effect(() => {
    if (!open || !requester) {
      secondsLeft = COUNTDOWN_SECONDS;
      return;
    }

    secondsLeft = COUNTDOWN_SECONDS;
    let remaining = COUNTDOWN_SECONDS;

    const intervalId = setInterval(() => {
      remaining -= 1;
      secondsLeft = remaining;
      if (remaining <= 0) {
        clearInterval(intervalId);
        ondeny();
      }
    }, 1000);

    return () => clearInterval(intervalId);
  });

  function handleDeny() {
    feedback.light();
    ondeny();
  }

  function handleAccept() {
    feedback.light();
    onaccept();
  }
</script>

<GenericModal
  {open}
  title="Solicitação de conexão"
  onClose={handleDeny}
  modalClass="modal-bottom sm:modal-middle">
  {#if requester}
    <p>
      <span class="font-semibold">{requester.displayName}</span>
      <span class="text-base-content/60"> ({requester.deviceHint})</span>
      quer se conectar para trocar arquivos.
    </p>
    <p class="text-base-content/60 mt-2 text-sm">
      Expira em
      <span class="countdown">
        <span
          style="--value:{secondsLeft};"
          aria-live="polite"
          aria-label={String(secondsLeft)}>{secondsLeft}</span>
      </span>
      s
    </p>
  {/if}
  {#snippet modalActions()}
    <button
      class="btn"
      onclick={handleDeny}>Recusar</button>
    <button
      class="btn btn-primary"
      onclick={handleAccept}>Aceitar</button>
  {/snippet}
</GenericModal>

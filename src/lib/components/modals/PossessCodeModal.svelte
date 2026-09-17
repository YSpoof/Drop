<script lang="ts">
  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import { SHARE_CODE_DIGITS } from "#lib/consts.js";
  import { feedback } from "#lib/utils/feedback.js";

  interface Props {
    open: boolean;
    onClose: () => void;
    onFound: (code: string) => void | string | null | Promise<void | string | null>;
    error?: string | null;
    closeLabel?: string;
  }

  let { open, onClose, onFound, error = null, closeLabel = "Cancelar" }: Props = $props();

  const otpSlots = Array.from({ length: SHARE_CODE_DIGITS }, (_, i) => i);

  let digits = $state("");
  let looking = $state(false);
  let localError = $derived(open ? (error ?? null) : null);
  let submitSeq = 0;

  function resetForm() {
    submitSeq += 1;
    digits = "";
    looking = false;
    localError = null;
  }

  function handleClose() {
    feedback.light();
    resetForm();
    onClose();
  }

  function handleInput() {
    digits = digits.replace(/\D/g, "").slice(0, SHARE_CODE_DIGITS);
    localError = null;
    if (digits.length === SHARE_CODE_DIGITS && !looking) void handleSubmit();
  }

  async function handleSubmit(event?: Event) {
    event?.preventDefault();
    if (digits.length !== SHARE_CODE_DIGITS || looking) return;

    feedback.light();
    const seq = ++submitSeq;
    looking = true;
    localError = null;

    try {
      const result = await onFound(digits);
      digits = "";
      if (result) localError = result;
    } finally {
      if (seq === submitSeq) looking = false;
    }
  }
</script>

<GenericModal
  {open}
  title="Possuo um código"
  onClose={handleClose}>
  <form
    id="possess-code-form"
    class="flex flex-col items-center gap-3 py-2"
    onsubmit={handleSubmit}>
    <label
      class="otp otp-lg otp-joined mx-auto"
      class:otp-error={!!localError}>
      {#each otpSlots as slot (slot)}
        <span></span>
      {/each}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        autofocus
        autocomplete="one-time-code"
        inputmode="numeric"
        maxlength={SHARE_CODE_DIGITS}
        pattern={`[0-9]{${SHARE_CODE_DIGITS}}`}
        aria-label={`Código de ${SHARE_CODE_DIGITS} dígitos`}
        bind:value={digits}
        oninput={handleInput}
        disabled={looking} />
    </label>
    {#if looking}
      <p class="text-base-content/70 flex items-center gap-2 text-sm">
        <span class="loading loading-spinner loading-sm"></span>
        Verificando…
      </p>
    {:else if localError}
      <p class="text-error text-center text-sm">{localError}</p>
    {/if}
  </form>

  {#snippet modalActions()}
    <button
      type="button"
      class="btn"
      onclick={handleClose}>
      {closeLabel}
    </button>
  {/snippet}
</GenericModal>

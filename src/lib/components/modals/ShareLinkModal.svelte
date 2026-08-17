<script lang="ts">
  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import { feedback } from "#lib/utils/feedback.js";
  import { tick } from "svelte";
  import CheckCircleIcon from "~icons/mdi/check-circle";
  import ContentCopyIcon from "~icons/mdi/content-copy";
  import ExitToAppIcon from "~icons/mdi/exit-to-app";
  import LightningBoltIcon from "~icons/mdi/lightning-bolt";
  import LinkVariantIcon from "~icons/mdi/link-variant";
  import SwapHorizontalIcon from "~icons/mdi/swap-horizontal";

  interface Props {
    open: boolean;
    inRoom: boolean;
    mode: "manual" | "auto" | null;
    link: string | null;
    onSelectManual: () => void | Promise<void>;
    onSelectAuto: () => void | Promise<void>;
    onLeaveRoom: () => void;
    onClose: () => void;
  }

  let { open, inRoom, mode, link, onSelectManual, onSelectAuto, onLeaveRoom, onClose }: Props =
    $props();

  const isAuto = $derived(mode === "auto");

  let copied = $state(false);

  function markCopied() {
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 2500);
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      markCopied();
    } catch {
      // ignore
    }
  }

  async function handleSelectManual() {
    feedback.light();
    await onSelectManual();
    await tick();
    await copyLink();
  }

  async function handleSelectAuto() {
    feedback.light();
    await onSelectAuto();
    await tick();
    await copyLink();
  }

  async function handleCopy() {
    feedback.light();
    await copyLink();
  }

  function handleLeaveRoom() {
    feedback.medium();
    onLeaveRoom();
  }

  function handleClose() {
    feedback.light();
    onClose();
  }
</script>

<GenericModal
  {open}
  title="Conectar remotamente"
  onClose={handleClose}>
  {#if inRoom}
    <div class="flex flex-col items-center gap-5 py-2 text-center">
      <div
        class="bg-primary/10 flex size-16 items-center justify-center rounded-full"
        aria-hidden="true">
        {#if isAuto}
          <LightningBoltIcon class="text-primary text-3xl" />
        {:else}
          <LinkVariantIcon class="text-primary text-3xl" />
        {/if}
      </div>

      <div class="flex flex-col gap-1">
        <p class="text-lg font-semibold">
          {isAuto ? "Modo automático" : "Modo manual"}
        </p>
        <p class="text-base-content/70 max-w-xs text-sm text-balance">
          {#if isAuto}
            Envie o link. A outra pessoa conecta na hora, sem sua aprovação.
          {:else}
            Envie o link. A outra pessoa solicita conexão e você aprova.
          {/if}
        </p>
      </div>

      <button
        type="button"
        class="btn btn-lg w-full gap-2"
        class:btn-primary={!copied}
        class:btn-success={copied}
        disabled={copied}
        onclick={handleCopy}>
        {#if copied}
          <CheckCircleIcon class="text-xl" />
          Link copiado!
        {:else}
          <ContentCopyIcon class="text-xl" />
          Copiar link
        {/if}
      </button>

      <button
        type="button"
        class="btn btn-ghost btn-sm gap-1.5"
        onclick={isAuto ? handleSelectManual : handleSelectAuto}>
        <SwapHorizontalIcon class="text-base" />
        Trocar para {isAuto ? "modo manual" : "modo automático"}
      </button>
    </div>
  {:else}
    <div class="flex flex-col gap-3 sm:flex-row">
      <button
        type="button"
        class="card bg-base-100 dark:bg-base-300 hover:border-primary flex-1 border-2 border-transparent text-left shadow-sm transition-colors"
        onclick={handleSelectManual}>
        <div class="card-body gap-1 p-4">
          <div class="flex items-center gap-2">
            <LinkVariantIcon class="text-primary text-xl" />
            <h3 class="font-semibold">Modo manual</h3>
          </div>
          <p class="text-base-content/70 text-sm">
            Copie o link e envie. A outra pessoa solicita conexão e você aprova.
          </p>
        </div>
      </button>

      <button
        type="button"
        class="card bg-base-100 dark:bg-base-300 hover:border-primary flex-1 border-2 border-transparent text-left shadow-sm transition-colors"
        onclick={handleSelectAuto}>
        <div class="card-body gap-1 p-4">
          <div class="flex items-center gap-2">
            <LightningBoltIcon class="text-primary text-xl" />
            <h3 class="font-semibold">Modo automático</h3>
          </div>
          <p class="text-base-content/70 text-sm">
            Um código vai embutido no link, a outra pessoa conecta na hora, sem aprovação.
          </p>
        </div>
      </button>
    </div>
  {/if}

  {#snippet modalActions()}
    {#if inRoom}
      <button
        type="button"
        class="btn btn-ghost btn-error gap-2"
        onclick={handleLeaveRoom}>
        <ExitToAppIcon class="text-lg" />
        Sair da sala
      </button>
    {:else}
      <button
        type="button"
        class="btn"
        onclick={handleClose}>
        Cancelar
      </button>
    {/if}
  {/snippet}
</GenericModal>

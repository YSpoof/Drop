<script lang="ts">
  import CheckCircleIcon from "~icons/mdi/check-circle";
  import ContentCopyIcon from "~icons/mdi/content-copy";
  import EmailAlertIcon from "~icons/mdi/email-alert-outline";
  import HandCoinIcon from "~icons/mdi/hand-coin-outline";
  import WaterSyncIcon from "~icons/mdi/water-sync";

  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import { siteData } from "#lib/siteData.js";
  import { uiStore } from "#lib/stores/uiStore.svelte.js";

  let copied = $state(false);

  async function copyPixKey() {
    try {
      await navigator.clipboard.writeText(siteData.donationPixKey);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2500);
    } catch {
      // ignore
    }
  }
</script>

<GenericModal
  open={uiStore.infoModalOpen}
  title="Sobre o App"
  onClose={() => (uiStore.infoModalOpen = false)}
  modalClass="w-full md:max-w-xl">
  <div class="flex flex-col gap-5 py-1">
    <div class="flex flex-col items-center gap-3 text-center">
      <div class="bg-primary/10 text-primary flex size-16 items-center justify-center rounded-full">
        <WaterSyncIcon class="text-4xl" />
      </div>
      <div>
        <h3 class="text-lg font-bold">{siteData.name}</h3>
        <p class="text-base-content/60 text-sm">{siteData.tag}</p>
      </div>
    </div>

    <p class="text-base-content/70 text-center text-sm text-balance">
      Esse app permite transferir arquivos entre dispositivos na sua rede local ou remotamente
      utilizando o máximo da sua conexão.
    </p>

    <div class="divider my-0"></div>

    <div class="flex items-start gap-3">
      <div
        class="bg-secondary/10 text-secondary flex size-10 shrink-0 items-center justify-center rounded-full">
        <HandCoinIcon class="text-xl" />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <p class="font-semibold">Contribua com o projeto</p>
          <p class="text-base-content/60 text-sm">Chave PIX aleatória, toque para copiar:</p>
        </div>
        <button
          type="button"
          class="btn btn-sm justify-between font-mono"
          class:btn-success={copied}
          onclick={copyPixKey}>
          <span class="truncate">{siteData.donationPixKey}</span>
          {#if copied}
            <CheckCircleIcon class="text-base" />
          {:else}
            <ContentCopyIcon class="text-base" />
          {/if}
        </button>
      </div>
    </div>

    <div class="flex items-start gap-3">
      <div
        class="bg-info/10 text-info flex size-10 shrink-0 items-center justify-center rounded-full">
        <EmailAlertIcon class="text-xl" />
      </div>
      <div class="flex flex-col gap-1">
        <p class="font-semibold">Encontrou um bug?</p>
        <a
          href="mailto:contato@lzart.com.br"
          class="link link-accent w-fit text-sm"
          rel="noopener noreferrer"
          target="_blank">contato@lzart.com.br</a>
      </div>
    </div>
  </div>

  {#snippet modalActions()}
    <button
      class="btn btn-primary"
      onclick={() => (uiStore.infoModalOpen = false)}>Fechar</button>
  {/snippet}
</GenericModal>

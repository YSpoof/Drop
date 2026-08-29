<script lang="ts">
  import { onMount, type Component } from "svelte";
  import { Tween } from "svelte/motion";
  import AccountEditIcon from "~icons/mdi/account-edit";
  import CogIcon from "~icons/mdi/cog";
  import DownloadIcon from "~icons/mdi/download";
  import FolderMultipleIcon from "~icons/mdi/folder-multiple";
  import NumericIcon from "~icons/mdi/numeric";
  import WaterSyncIcon from "~icons/mdi/water-sync";

  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import { receiveFolder } from "#lib/runtime.js";
  import { siteData } from "#lib/siteData.js";
  import { deviceStore } from "#lib/stores/deviceStore.svelte.js";
  import { peerStore } from "#lib/stores/peerStore.svelte.js";
  import { transferStore } from "#lib/stores/transferStore.svelte.js";
  import { uiStore } from "#lib/stores/uiStore.svelte.js";
  import { feedback } from "#lib/utils/feedback.js";
  import { saveAutoDownload, saveReceiveFolderPath } from "#lib/utils/files/prefs.js";
  import { localForage } from "#lib/utils/localForage.js";

  type IntroStep = {
    title: string;
    body: string;
    Icon: Component;
    fields?: "name" | "download";
  };

  const steps: IntroStep[] = [
    {
      title: `Bem vindo ao ${siteData.name}`,
      body: `Um app de compartilhamento de arquivos P2P, que não armazena seus dados, não te limita e é de graça.`,
      Icon: WaterSyncIcon,
    },
    {
      title: "Botão flutuante",
      body: "Toque no botão de engrenagem no canto da tela para acessar configurações, estatísticas, esta configuração e informações.",
      Icon: CogIcon,
    },
    {
      title: "Identifique seu dispositivo",
      body: "Esse nome aparece para quem se conectar com você.",
      Icon: AccountEditIcon,
      fields: "name",
    },
    {
      title: "Modos de download",
      body: "No automático, os arquivos chegam direto. No manual, você escolhe o que baixar enquanto estiver conectado.",
      Icon: DownloadIcon,
      fields: "download",
    },
    {
      title: "Envie arquivos e pastas",
      body: "Ao adicionar, o app organiza tudo automaticamente para facilitar o envio e o recebimento.",
      Icon: FolderMultipleIcon,
    },
    {
      title: "Código de compartilhamento",
      body: "Toque em Gerar um código para criar uma sessão e copiar o link, ou Possuo um código para entrar com o PIN de 6 dígitos.",
      Icon: NumericIcon,
    },
  ];

  let currentStep = $state(0);
  let defaultReceiveFolder = $state("Downloads");

  const isLastStep = $derived(currentStep === steps.length - 1);
  const step = $derived(steps[currentStep]!);
  const displayPath = $derived(transferStore.receiveFolderPath || defaultReceiveFolder);

  const progress = new Tween((1 / steps.length) * 100, { duration: 100 });

  $effect(() => {
    saveAutoDownload(transferStore.autoDownload);
  });

  $effect(() => {
    progress.set(((currentStep + 1) / steps.length) * 100);
  });

  onMount(() => {
    if (!receiveFolder.canPick) return;
    receiveFolder
      .defaultPath()
      .then((path) => {
        if (path) defaultReceiveFolder = path;
      })
      .catch(() => {});
  });

  async function chooseReceiveFolder() {
    const selected = await receiveFolder.pick(transferStore.receiveFolderPath || undefined);
    if (!selected) return;
    transferStore.receiveFolderPath = selected;
    await saveReceiveFolderPath(selected);
  }

  function handleClose() {
    feedback.light();
    uiStore.setupWizardOpen = false;
    deviceStore.handleDisplayNameBlur();
    localForage.setItem("setupWizardViewed", true);
    setTimeout(() => {
      currentStep = 0;
      progress.set((1 / steps.length) * 100);
    }, 300);
  }

  function handlePrevious() {
    feedback.light();

    if (currentStep > 0) {
      currentStep--;
    }
  }

  function handleNext() {
    feedback.light();
    deviceStore.handleDisplayNameBlur();

    if (isLastStep) {
      handleClose();
      return;
    }

    currentStep++;
  }
</script>

<GenericModal
  open={uiStore.setupWizardOpen}
  modalClass="max-w-lg"
  title="Configuração inicial"
  onClose={handleClose}>
  {#key currentStep}
    <div class="space-y-8 py-2 text-center">
      <div
        class="bg-primary/10 text-primary mx-auto flex size-20 items-center justify-center rounded-full">
        <step.Icon class="text-5xl" />
      </div>

      <div class="space-y-3">
        <p class="text-base-content/60 text-sm">
          Passo {currentStep + 1} de {steps.length}
        </p>

        <h2 class="text-2xl font-bold">
          {step.title}
        </h2>

        <p class="text-base-content/70 mx-auto max-w-md text-balance">
          {step.body}
        </p>

        {#if step.fields === "name"}
          <label class="floating-label mx-auto max-w-md text-left">
            <input
              type="text"
              placeholder="Nome de exibição"
              class="input w-full"
              bind:value={deviceStore.displayName}
              onblur={() => deviceStore.handleDisplayNameBlur()} />
            <span>Nome de exibição</span>
          </label>
        {:else if step.fields === "download"}
          <div class="mx-auto max-w-md space-y-3 text-left">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium">Download automático</span>
              <input
                type="checkbox"
                class="toggle toggle-primary"
                bind:checked={transferStore.autoDownload}
                disabled={peerStore.connected} />
            </div>

            {#if receiveFolder.canPick}
              <div class="flex items-center justify-between gap-4">
                <div class="min-w-0 flex-1">
                  <span class="text-sm font-medium">Pasta para downloads</span>
                  <p
                    class="text-base-content/70 truncate text-xs"
                    title={displayPath}>
                    {displayPath}
                  </p>
                </div>
                <button
                  class="btn btn-sm"
                  disabled={peerStore.connected}
                  onclick={chooseReceiveFolder}>
                  Escolher pasta
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="space-y-3">
        <progress
          class="progress progress-primary w-full"
          value={progress.current}
          max={100}></progress>
      </div>
    </div>
  {/key}

  {#snippet modalActions()}
    <div class="flex w-full justify-between">
      <button
        class="btn btn-ghost"
        onclick={handlePrevious}
        disabled={currentStep === 0}>
        Anterior
      </button>

      <button
        class="btn btn-primary min-w-32"
        onclick={handleNext}>
        {isLastStep ? "Começar" : "Próximo"}
      </button>
    </div>
  {/snippet}
</GenericModal>

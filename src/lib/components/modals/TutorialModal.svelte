<script lang="ts">
  import GenericModal from "$lib/components/ui/GenericModal.svelte";
  import { siteData } from "$lib/siteData";
  import { appState } from "$lib/stores/appState.svelte";
  import { localForage } from "$lib/utils/localForage";
  import vibrate from "$lib/utils/vibrate";
  import type { Component } from "svelte";
  import { Tween } from "svelte/motion";
  import AccountEditIcon from "~icons/mdi/account-edit";
  import DownloadIcon from "~icons/mdi/download";
  import FolderMultipleIcon from "~icons/mdi/folder-multiple";
  import LinkIcon from "~icons/mdi/link";
  import PlusIcon from "~icons/mdi/plus";
  import WaterSyncIcon from "~icons/mdi/water-sync";

  type IntroStep = {
    title: string;
    body: string;
    Icon: Component;
  };

  const steps: IntroStep[] = [
    {
      title: `Bem-vindo ao ${siteData.name}`,
      body: `Um app de compartilhamento de arquivos P2P, que não armazena seus dados, não te limita e é de graça.`,
      Icon: WaterSyncIcon,
    },
    {
      title: "Botão flutuante",
      body: "Toque no botão + no canto da tela para acessar configurações, estatísticas, tutorial, informações e compartilhamento de link.",
      Icon: PlusIcon,
    },
    {
      title: "Identifique seu dispositivo",
      body: "Altere o seu nome no menu de Configurações para que outras pessoas reconheçam você na lista.",
      Icon: AccountEditIcon,
    },
    {
      title: "Modos de download",
      body: "Escolha entre download automático ou manual no menu de Configurações. No modo manual, você decide quando baixar cada arquivo enquanto estiver conectado a um amigo.",
      Icon: DownloadIcon,
    },
    {
      title: "Envie arquivos e pastas",
      body: "Ao adicionar, o app organiza tudo automaticamente para facilitar o envio e o recebimento.",
      Icon: FolderMultipleIcon,
    },
    {
      title: "Conexão por link",
      body: "Gere um link de sala para se conectar com pessoas que não estão na mesma rede que você.",
      Icon: LinkIcon,
    },
  ];

  let currentStep = $state(0);

  const isLastStep = $derived(currentStep === steps.length - 1);
  const step = $derived(steps[currentStep]!);

  const progress = new Tween((1 / steps.length) * 100, { duration: 100 });

  function handleClose() {
    vibrate.light();
    appState.tutorialModalOpen = false;
    localForage.setItem("tutorialViewed", true);
    setTimeout(() => {
      currentStep = 0;
      progress.set((1 / steps.length) * 100);
    }, 300);
  }

  function handlePrevious() {
    vibrate.light();

    if (currentStep > 0) {
      currentStep--;
    }
  }

  function handleNext() {
    vibrate.light();

    if (isLastStep) {
      handleClose();
      return;
    }

    currentStep++;
  }

  $effect(() => {
    progress.set(((currentStep + 1) / steps.length) * 100);
  });
</script>

<GenericModal
  open={appState.tutorialModalOpen}
  modalClass="max-w-lg"
  title="Tutorial"
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

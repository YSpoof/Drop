<script lang="ts">
  import MonitorIcon from "~icons/mdi/monitor";
  import TrayArrowDownIcon from "~icons/mdi/tray-arrow-down";
  import WebIcon from "~icons/mdi/web";

  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import { environment } from "#lib/runtime.js";
  import { siteData } from "#lib/siteData.js";
  import { installPromptStore } from "#lib/stores/installPrompt.svelte.js";
  import { toastStore } from "#lib/stores/toast.svelte.js";
  import { isWindowsOrLinux } from "#lib/utils/device/os.js";

  const desktopOs = isWindowsOrLinux();
  const desktopFeatures = [
    "Transferências retomáveis",
    "Pasta de download personalizada",
    "Detecção automática em pastas",
    "Transferências estáveis",
  ];
  const choiceCardClass =
    "card bg-base-100 dark:bg-base-300 hover:border-primary border-2 border-transparent text-left shadow-sm transition-colors";

  let modalOpen = $state(false);
  const showButton = $derived(!environment.isNative && (desktopOs || !!installPromptStore.current));

  const installPwa = async () => {
    const prompt = installPromptStore.current;
    if (!prompt) {
      toastStore.showToast("Use o ícone de instalar na barra do navegador.", "info");
      return;
    }

    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      toastStore.showToast("Instalando, confira suas notificações.");
      installPromptStore.clear();
    }
    modalOpen = false;
  };

  const openDesktopDownload = () => {
    window.open(siteData.driveDownloadLink, "_blank", "noopener,noreferrer");
    modalOpen = false;
  };

  const handleClick = () => {
    if (desktopOs) {
      modalOpen = true;
      return;
    }
    void installPwa();
  };
</script>

{#if showButton}
  <button
    type="button"
    onclick={handleClick}
    class="install-app-btn btn btn-ghost btn-circle btn-primary btn-soft tooltip tooltip-left"
    data-tip="Instalar Aplicativo">
    <TrayArrowDownIcon class="text-lg" />
  </button>
{/if}

<GenericModal
  open={modalOpen}
  title="Instalar aplicativo"
  onClose={() => (modalOpen = false)}
  modalClass="w-full md:max-w-sm">
  <div class="flex flex-col gap-3">
    <button
      type="button"
      class={choiceCardClass}
      onclick={openDesktopDownload}>
      <div class="card-body gap-2 p-6">
        <div class="flex items-center gap-2">
          <MonitorIcon class="text-primary text-2xl" />
          <h2 class="text-lg font-semibold">Versão desktop</h2>
        </div>
        <ul class="text-base-content/70 list-inside list-disc text-sm">
          {#each desktopFeatures as feature (feature)}
            <li>{feature}</li>
          {/each}
        </ul>
      </div>
    </button>

    <button
      type="button"
      class={choiceCardClass}
      onclick={installPwa}>
      <div class="card-body gap-2 p-6">
        <div class="flex items-center gap-2">
          <WebIcon class="text-primary text-2xl" />
          <h2 class="text-lg font-semibold">Versão universal (PWA)</h2>
        </div>
        <p class="text-base-content/70 text-sm">Acesso mais fácil</p>
      </div>
    </button>
  </div>
</GenericModal>

<style>
  @media (display-mode: standalone) {
    .install-app-btn {
      display: none;
    }
  }
</style>

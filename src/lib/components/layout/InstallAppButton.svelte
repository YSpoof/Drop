<script lang="ts">
  import { inject } from "quick-di";
  import ArrowLeftIcon from "~icons/mdi/arrow-left";
  import ConsoleIcon from "~icons/mdi/console";
  import MonitorIcon from "~icons/mdi/monitor";
  import TrayArrowDownIcon from "~icons/mdi/tray-arrow-down";
  import WebIcon from "~icons/mdi/web";

  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import { EnvironmentPort } from "#lib/ports/environment.js";
  import { siteData } from "#lib/siteData.js";
  import { installPromptStore } from "#lib/stores/installPrompt.svelte.js";
  import { toastStore } from "#lib/stores/toast.svelte.js";
  import { isWindowsOrLinux } from "#lib/utils/device/os.js";

  type ProductChoice = "cli" | "app" | null;

  const environment = inject(EnvironmentPort);
  const desktopOs = isWindowsOrLinux();
  const desktopFeatures = [
    "Transferências retomáveis",
    "Pasta de download personalizada",
    "Detecção automática em pastas",
    "Transferências estáveis",
  ];
  const choiceCardClass =
    "card bg-base-100 dark:bg-base-300 hover:border-primary border-2 border-transparent text-left shadow-sm transition-colors";
  const desktopCardClass =
    "card bg-base-100 dark:bg-base-300 border-2 border-transparent text-left shadow-sm";
  const downloadLinkClass = "btn btn-sm btn-block btn-primary btn-soft";

  let modalOpen = $state(false);
  let productChoice = $state<ProductChoice>(null);
  const showButton = $derived(!environment.isNative && (desktopOs || !!installPromptStore.current));

  const closeModal = () => {
    modalOpen = false;
    productChoice = null;
  };

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
    closeModal();
  };

  const handleClick = () => {
    if (desktopOs) {
      productChoice = null;
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
  onClose={closeModal}
  modalClass="w-full md:max-w-sm">
  <div class="flex flex-col gap-3">
    {#if productChoice === null}
      <button
        type="button"
        class={choiceCardClass}
        onclick={() => (productChoice = "cli")}>
        <div class="card-body gap-2 p-6">
          <div class="flex items-center gap-2">
            <ConsoleIcon class="text-primary text-2xl" />
            <h2 class="text-lg font-semibold">CLI</h2>
          </div>
          <p class="text-base-content/70 text-sm">Terminal e scripts</p>
        </div>
      </button>

      <button
        type="button"
        class={choiceCardClass}
        onclick={() => (productChoice = "app")}>
        <div class="card-body gap-2 p-6">
          <div class="flex items-center gap-2">
            <MonitorIcon class="text-primary text-2xl" />
            <h2 class="text-lg font-semibold">Aplicativo</h2>
          </div>
          <p class="text-base-content/70 text-sm">Versão desktop completa</p>
        </div>
      </button>
    {:else}
      <button
        type="button"
        class="btn btn-ghost btn-sm gap-1 self-start px-1"
        onclick={() => (productChoice = null)}>
        <ArrowLeftIcon class="text-base" />
        Voltar
      </button>

      {#if productChoice === "cli"}
        <div class={desktopCardClass}>
          <div class="card-body gap-2 p-6">
            <div class="flex items-center gap-2">
              <ConsoleIcon class="text-primary text-2xl" />
              <h2 class="text-lg font-semibold">CLI</h2>
            </div>
            <a
              role="button"
              class={downloadLinkClass}
              href={siteData.cliDownloads.windows}
              download="Drop-cli-win_x64.exe">
              Windows
            </a>
            <a
              role="button"
              class={downloadLinkClass}
              href={siteData.cliDownloads.linux}
              download="Drop-cli-linux_x64">
              Linux
            </a>
            <p class="text-base-content/60 text-xs">
              No Linux, após baixar:
              <code class="whitespace-nowrap">chmod +x Drop-cli-linux_x64</code>
            </p>
          </div>
        </div>
      {:else}
        <div class={desktopCardClass}>
          <div class="card-body gap-2 p-6">
            <div class="flex items-center gap-2">
              <MonitorIcon class="text-primary text-2xl" />
              <h2 class="text-lg font-semibold">Aplicativo</h2>
            </div>
            <ul class="text-base-content/70 list-inside list-disc text-sm">
              {#each desktopFeatures as feature (feature)}
                <li>{feature}</li>
              {/each}
            </ul>
            <a
              role="button"
              class={downloadLinkClass}
              href={siteData.desktopDownloads.windows}
              download="Drop-win_x64.exe">
              Windows
            </a>
            <a
              role="button"
              class={downloadLinkClass}
              href={siteData.desktopDownloads.linux}
              download="Drop-linux_x64">
              Linux
            </a>
            <p class="text-base-content/60 text-xs">
              No Linux, após baixar:
              <code class="whitespace-nowrap">chmod +x Drop-linux_x64</code>
            </p>
          </div>
        </div>

        <button
          type="button"
          class="btn btn-ghost btn-sm text-base-content/60 gap-2"
          onclick={installPwa}>
          <WebIcon class="text-base" />
          Ou instalar como PWA
        </button>
      {/if}
    {/if}
  </div>
</GenericModal>

<style>
  @media (display-mode: standalone) {
    .install-app-btn {
      display: none;
    }
  }
</style>

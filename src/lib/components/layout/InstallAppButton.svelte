<script lang="ts">
  import { appState } from "$lib/stores/appState.svelte";
  import { toastStore } from "$lib/stores/toast.svelte";
  import TrayArrowDownIcon from "~icons/mdi/tray-arrow-down";

  const installApp = async () => {
    const prompt = appState.installPrompt;
    if (!prompt) return;

    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      toastStore.showToast("Instalando, confira suas notificações.");
      appState.clearInstallPrompt();
    }
  };
</script>

{#if appState.installPrompt}
  <button
    type="button"
    onclick={installApp}
    class="install-app-btn btn btn-ghost btn-circle btn-primary btn-soft tooltip tooltip-left"
    data-tip="Instalar Aplicativo">
    <TrayArrowDownIcon class="text-lg" />
  </button>
{/if}

<style>
  @media (display-mode: standalone) {
    .install-app-btn {
      display: none;
    }
  }
</style>

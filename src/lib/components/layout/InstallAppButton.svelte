<script lang="ts">
  import TrayArrowDownIcon from "~icons/mdi/tray-arrow-down";

  import { toastStore } from "#lib/stores/toast.svelte.js";
  import { uiStore } from "#lib/stores/uiStore.svelte.js";

  const installApp = async () => {
    const prompt = uiStore.installPrompt;
    if (!prompt) return;

    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      toastStore.showToast("Instalando, confira suas notificações.");
      uiStore.clearInstallPrompt();
    }
  };
</script>

{#if uiStore.installPrompt}
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

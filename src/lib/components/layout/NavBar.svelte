<script lang="ts">
  import InstallAppButton from "$lib/components/layout/InstallAppButton.svelte";
  import { siteData } from "$lib/siteData";
  import { appState } from "$lib/stores/appState.svelte";
  import { toastStore } from "$lib/stores/toast.svelte";
  import { feedback } from "$lib/utils/feedback";
  import BugIcon from "~icons/mdi/bug";
  import WaterSyncIcon from "~icons/mdi/water-sync";

  const TAP_WINDOW_MS = 2000;
  const DEV_MODE_TAPS = 5;

  let tapCount = 0;
  let lastTapAt = 0;

  const handleLogoClick = () => {
    feedback.heavy();
    if (appState.devMode) {
      appState.setDevMode(false);
      toastStore.showToast("Modo desenvolvedor desativado", "info");
      tapCount = 0;
      return;
    }

    const now = Date.now();
    if (now - lastTapAt > TAP_WINDOW_MS) {
      tapCount = 0;
    }
    lastTapAt = now;
    tapCount += 1;

    if (tapCount >= DEV_MODE_TAPS) {
      appState.setDevMode(true);
      toastStore.showToast("Modo desenvolvedor ativado", "info");
      tapCount = 0;
    }
  };
</script>

<header class="bg-base-100 dark:bg-300 w-full">
  <div class="container mx-auto">
    <div class="navbar">
      <div class="flex-1">
        <div class="flex items-center gap-4">
          <button
            type="button"
            onclick={handleLogoClick}
            class="grid aspect-square h-10 w-10 place-items-center rounded-sm transition-transform active:scale-95"
            class:bg-error={appState.devMode}
            class:bg-primary={!appState.devMode}>
            {#if appState.devMode}
              <BugIcon class="text-2xl text-white" />
            {:else}
              <WaterSyncIcon class="text-3xl text-white" />
            {/if}
          </button>
          <div class="flex flex-col gap-1">
            <h1 class="text-lg font-bold">{siteData.name}</h1>
            <p class="text-xs">{siteData.tag}</p>
          </div>
        </div>
      </div>
      <div class="flex flex-none items-center gap-2">
        <InstallAppButton />
      </div>
    </div>
  </div>
</header>

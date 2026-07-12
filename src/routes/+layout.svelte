<script lang="ts">
  import "./layout.css";
  import { dev } from "$app/env";
  import { updated } from "$app/state";
  import NavBar from "$lib/components/layout/NavBar.svelte";
  import ToastRenderer from "$lib/components/ui/ToastRenderer.svelte";
  import { siteData } from "$lib/siteData";
  import { appState } from "$lib/stores/appState.svelte";
  import { lazyLoad } from "$lib/stores/lazyLoad.svelte";
  import { abortOnPageClose, flushStatsOnHide } from "$lib/utils/pageUnload";
  import { onMount } from "svelte";

  let { children } = $props();

  $effect.pre(() => {
    if (appState.tutorialModalOpen) lazyLoad.mark("tutorialModal");
    if (appState.infoModalOpen) lazyLoad.mark("infoModal");
    if (appState.statsModalOpen) lazyLoad.mark("statsModal");
    if (updated.current) lazyLoad.mark("updateModal");
  });

  const handleBeforeInstallPrompt = (e: Event) => {
    e.preventDefault();
    appState.setInstallPrompt(e as BeforeInstallPromptEvent);
  };

  const handleAppInstalled = () => {
    appState.clearInstallPrompt();
  };

  onMount(() => {
    updated.check();

    if (!dev) {
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${siteData.googleAnalyticsId}`;
      document.head.appendChild(script);

      window.dataLayer = window.dataLayer || [];
      window.gtag = function () {
        window.dataLayer?.push(arguments);
      };
      window.gtag("js", new Date());
      window.gtag("config", siteData.googleAnalyticsId);
    }
  });
</script>

<svelte:window
  onpagehide={flushStatsOnHide}
  onbeforeunload={abortOnPageClose}
  onbeforeinstallprompt={handleBeforeInstallPrompt}
  onappinstalled={handleAppInstalled} />

<div class="bg-base-200 min-h-screen">
  <NavBar />
  <main class="bg-base-200 container mx-auto overflow-x-clip px-4">
    {@render children()}
  </main>
</div>

<ToastRenderer />

{#if lazyLoad.has("tutorialModal")}
  {const TutorialModal = (await import("$lib/components/modals/TutorialModal.svelte")).default}
  <TutorialModal />
{/if}

{#if lazyLoad.has("infoModal")}
  {const InfoModal = (await import("$lib/components/modals/InfoModal.svelte")).default}
  <InfoModal />
{/if}

{#if lazyLoad.has("statsModal")}
  {const StatsModal = (await import("$lib/components/modals/StatsModal.svelte")).default}
  <StatsModal />
{/if}

{#if lazyLoad.has("updateModal")}
  {const UpdateModal = (await import("$lib/components/modals/UpdateModal.svelte")).default}
  <UpdateModal open={updated.current} />
{/if}

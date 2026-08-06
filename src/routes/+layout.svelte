<script lang="ts">
  import "./layout.css";
  import { dev } from "$app/env";
  import { updated } from "$app/state";
  import Fab from "$lib/components/layout/Fab.svelte";
  import NavBar from "$lib/components/layout/NavBar.svelte";
  import ToastRenderer from "$lib/components/ui/ToastRenderer.svelte";
  import { siteData } from "$lib/siteData";
  import { lazyLoad } from "$lib/stores/lazyLoad.svelte";
  import { uiStore } from "$lib/stores/uiStore.svelte";
  import { layoutModals } from "$lib/utils/layoutModals";
  import { abortOnPageClose, flushStatsOnHide } from "$lib/utils/pageUnload";
  import { onMount } from "svelte";

  let { children } = $props();

  $effect.pre(() => {
    for (const modal of layoutModals) {
      if (modal.isOpen()) lazyLoad.mark(modal.key);
    }
    if (updated.current) lazyLoad.mark("updateModal");
  });

  const handleBeforeInstallPrompt = (e: Event) => {
    e.preventDefault();
    uiStore.setInstallPrompt(e as BeforeInstallPromptEvent);
  };

  const handleAppInstalled = () => {
    uiStore.clearInstallPrompt();
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
<Fab />

<ToastRenderer />

{#each layoutModals as modal (modal.key)}
  {#if lazyLoad.has(modal.key)}
    {const Component = (await modal.load()).default}
    <Component />
  {/if}
{/each}

{#if lazyLoad.has("updateModal")}
  {const UpdateModal = (await import("$lib/components/modals/UpdateModal.svelte")).default}
  <UpdateModal open={updated.current} />
{/if}

<script lang="ts">
  import "./layout.css";
  import { dev } from "$app/env";
  import { updated } from "$app/state";
  import { onMount } from "svelte";
  import { lazy } from "svelte-comp-lazyloader";

  import NavBar from "#lib/components/layout/NavBar.svelte";
  import { siteData } from "#lib/siteData.js";
  import { lazyLoad } from "#lib/stores/lazyLoad.svelte.js";
  import { layoutModals } from "#lib/utils/layoutModals.js";
  import { abortOnPageClose, flushStatsOnHide } from "#lib/utils/pageUnload.js";

  const UpdateModal = lazy(() => import("#lib/components/modals/UpdateModal.svelte"));
  const ToastRenderer = lazy(() => import("#lib/components/ui/ToastRenderer.svelte"));
  const Fab = lazy(() => import("#lib/components/layout/Fab.svelte"));

  let { children } = $props();

  $effect.pre(() => {
    for (const modal of layoutModals) {
      if (modal.isOpen()) lazyLoad.mark(modal.key);
    }
    if (updated.current) lazyLoad.mark("updateModal");
  });

  $effect(() => {
    if (updated.current) {
      console.log("New version available.");
    }
  });

  onMount(() => {
    queueMicrotask(() => {
      updated.check();
    });

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
  onbeforeunload={abortOnPageClose} />

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
    {const Component = modal.Component}
    <Component />
  {/if}
{/each}

{#if lazyLoad.has("updateModal")}
  <UpdateModal open={updated.current} />
{/if}

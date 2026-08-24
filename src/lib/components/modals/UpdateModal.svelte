<script lang="ts">
  import GenericModal from "#lib/components/ui/GenericModal.svelte";

  interface Props {
    open: boolean;
  }

  let { open }: Props = $props();

  let isReloading = $state(false);

  const handleReload = async () => {
    isReloading = true;
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      const sw = registration.active || registration.waiting || registration.installing;
      console.log("Killing service worker", sw);
      sw?.postMessage({ type: "KILL" });
    }
    setTimeout(() => {
      globalThis.location.reload();
    }, 1500);
  };
</script>

<GenericModal
  {open}
  cantClose
  title="Nova versão disponível"
>
  <p>O Drop foi atualizado, por favor, recarregue a página!</p>
  {#snippet modalActions()}
    <button
      class="btn btn-primary"
      onclick={handleReload}
      disabled={isReloading}
    >
      {#if isReloading}
        <span class="loading loading-spinner loading-sm"></span>
        Recarregando...
      {:else}
        Recarregar
      {/if}
    </button>
  {/snippet}
</GenericModal>

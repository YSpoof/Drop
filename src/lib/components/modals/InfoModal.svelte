<script lang="ts">
  import GenericModal from "$lib/components/ui/GenericModal.svelte";
  import { siteData } from "$lib/siteData";
  import { appState } from "$lib/stores/appState.svelte";
</script>

<GenericModal
  open={appState.infoModalOpen}
  title="Sobre o App"
  onClose={() => (appState.infoModalOpen = false)}>
  <div class="card bg-base-100 dark:bg-base-300 shadow-sm">
    <div class="card-body">
      <p>
        Esse app permite transferir arquivos entre dispositivos na sua rede local ou remotamente.
      </p>
      <p>No momento essa aplicação está em fase de testes e bugs podem ocorrer.</p>
      <p>Se quiser fazer uma contribuição, a chave PIX aleatória é:</p>
      <input
        name="donationPixKey"
        type="text"
        value={siteData.donationPixKey}
        class="input input-bordered w-full"
        readonly
        onclick={(e) => {
          (e.target as HTMLInputElement).select();
          navigator.clipboard.writeText((e.target as HTMLInputElement).value);
        }} />
      <p>Se você encontrar algum bug, por favor, entre em contato e reporte:</p>
      <a
        href="mailto:contato@lzart.com.br"
        class="link link-accent w-fit"
        rel="noopener noreferrer"
        target="_blank">contato@lzart.com.br</a>
    </div>
  </div>
  {#snippet modalActions()}
    <button
      onclick={() => {
        appState.tutorialModalOpen = true;
        appState.infoModalOpen = false;
      }}
      class="btn btn-ghost btn-info">
      Rever tutorial
    </button>
    <button
      onclick={() => {
        appState.statsModalOpen = true;
        appState.infoModalOpen = false;
      }}
      class="btn btn-ghost">
      Estatísticas
    </button>

    <button
      class="btn btn-primary"
      onclick={() => (appState.infoModalOpen = false)}>Fechar</button>
  {/snippet}
</GenericModal>

<script lang="ts">
  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import { appState } from "#lib/stores/appState.svelte.js";
</script>

<GenericModal
  open={appState.unsupportedBrowserModalOpen}
  cantClose={true}
  title="Navegador não suportado">
  <p class="text-base-content/80 text-sm">
    Este app precisa de um navegador moderno para funcionar corretamente.
  </p>
  <p class="text-base-content/70 mt-3 text-sm">Recomendamos usar o Google Chrome.</p>
</GenericModal>

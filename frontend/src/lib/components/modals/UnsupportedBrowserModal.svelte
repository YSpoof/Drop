<script lang="ts">
  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import { uiStore } from "#lib/stores/uiStore.svelte.js";
</script>

<GenericModal
  open={uiStore.unsupportedBrowserModalOpen}
  cantClose={true}
  title="Navegador não suportado">
  <p class="text-base-content/80 text-sm">
    Este app precisa de um navegador moderno para funcionar corretamente.
  </p>
  <p class="text-base-content/70 mt-3 text-sm">Recomendamos usar o Google Chrome.</p>
</GenericModal>

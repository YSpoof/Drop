<script lang="ts">
  import FolderOpenIcon from "~icons/mdi/folder-open";

  interface Props {
    dragOver: boolean;
  }

  let { dragOver }: Props = $props();
</script>

{#if dragOver}
  <div
    class="bg-base-100/80 border-primary fixed inset-0 z-50 flex items-center justify-center border-8 border-dashed backdrop-blur-sm">
    <div class="pointer-events-none text-center">
      <FolderOpenIcon class="text-primary mx-auto mb-4 text-6xl" />
      <h2 class="text-primary text-3xl font-bold">DROP arquivos e pastas aqui</h2>
    </div>
  </div>
{/if}

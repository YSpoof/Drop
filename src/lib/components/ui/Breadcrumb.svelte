<script lang="ts">
  import FolderIcon from "~icons/mdi/folder";

  interface Props {
    pathStack: string[];
    onnavigate: (newStack: string[]) => void;
  }

  let { pathStack, onnavigate }: Props = $props();

  function navigate(idx: number) {
    onnavigate(pathStack.slice(0, idx + 1));
  }

  function navigateHome() {
    onnavigate([]);
  }
</script>

<div class="bg-base-200/50 mb-4 flex flex-wrap items-center gap-1 rounded-lg px-3 py-2 text-sm">
  <button
    type="button"
    class="btn btn-link btn-xs text-base-content hover:text-primary flex items-center gap-1 px-1 no-underline"
    onclick={navigateHome}>
    <FolderIcon class="text-primary text-base" />
    /
  </button>
  {#each pathStack as segment, i}
    <span class="text-base-content/40">/</span>
    <button
      type="button"
      class="btn btn-link btn-xs text-base-content hover:text-primary px-1 font-medium no-underline"
      onclick={() => navigate(i)}>
      {segment}
    </button>
  {/each}
</div>

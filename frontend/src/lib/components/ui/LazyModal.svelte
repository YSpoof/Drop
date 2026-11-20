<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    open: boolean;
    children: Snippet;
  }

  let { open, children }: Props = $props();

  // Latches on the first open so the modal stays mounted (and can animate closed) afterwards.
  let opened = false;
  const mounted = $derived((opened ||= open));
</script>

{#if mounted}
  {@render children()}
{/if}

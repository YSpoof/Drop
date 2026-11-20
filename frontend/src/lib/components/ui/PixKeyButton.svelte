<script lang="ts">
  import CheckCircleIcon from "~icons/mdi/check-circle";
  import ContentCopyIcon from "~icons/mdi/content-copy";

  import { siteData } from "#lib/siteData.js";
  import { createCopied } from "#lib/utils/copied.svelte.js";

  const copied = createCopied();
</script>

<button
  type="button"
  class="btn btn-sm justify-between font-mono"
  class:btn-success={copied.current}
  onclick={() => copied.copy(siteData.donationPixKey, "copied")}>
  <span class="truncate">{siteData.donationPixKey}</span>
  {#if copied.current}
    <CheckCircleIcon class="text-base" />
  {:else}
    <ContentCopyIcon class="text-base" />
  {/if}
</button>

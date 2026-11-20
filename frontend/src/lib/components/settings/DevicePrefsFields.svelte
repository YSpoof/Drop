<script lang="ts">
  import { inject } from "quick-di";
  import { onMount } from "svelte";

  import { ReceiveFolderPort } from "#lib/ports/receiveFolder.js";
  import { deviceStore } from "#lib/stores/deviceStore.svelte.js";
  import { peerStore } from "#lib/stores/peerStore.svelte.js";
  import { transferStore } from "#lib/stores/transferStore.svelte.js";

  type Part = "name" | "download";

  interface Props {
    parts?: Part[];
    class?: string;
  }

  let { parts = ["name", "download"], class: className }: Props = $props();

  const receiveFolder = inject(ReceiveFolderPort);
  let defaultReceiveFolder = $state("Downloads");
  const displayPath = $derived(transferStore.receiveFolderPath || defaultReceiveFolder);

  onMount(() => {
    if (!receiveFolder.canPick || !parts.includes("download")) return;
    receiveFolder
      .defaultPath()
      .then((path) => {
        if (path) defaultReceiveFolder = path;
      })
      .catch(() => {});
  });

  async function chooseReceiveFolder() {
    const selected = await receiveFolder.pick(transferStore.receiveFolderPath || undefined);
    if (selected) await transferStore.setReceiveFolderPath(selected);
  }
</script>

<div class={className}>
  {#if parts.includes("name")}
    <label class="floating-label">
      <input
        type="text"
        placeholder="Nome de exibição"
        class="input w-full"
        bind:value={deviceStore.displayName}
        onblur={() => deviceStore.handleDisplayNameBlur()} />
      <span>Nome de exibição</span>
    </label>
  {/if}

  {#if parts.includes("download")}
    <div class="flex items-center justify-between">
      <span class="text-sm font-medium">Download automático</span>
      <input
        type="checkbox"
        class="toggle toggle-primary"
        bind:checked={
          () => transferStore.autoDownload, (value) => transferStore.setAutoDownload(value)
        }
        disabled={peerStore.connected} />
    </div>

    {#if receiveFolder.canPick}
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0 flex-1">
          <span class="text-sm font-medium">Pasta para downloads</span>
          <p
            class="text-base-content/70 truncate text-xs"
            title={displayPath}>
            {displayPath}
          </p>
        </div>
        <button
          class="btn btn-sm"
          disabled={peerStore.connected}
          onclick={chooseReceiveFolder}>
          Escolher pasta
        </button>
      </div>
    {/if}
  {/if}
</div>

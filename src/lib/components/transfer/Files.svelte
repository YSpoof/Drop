<script lang="ts">
  import { lazyLoad } from "$lib/stores/lazyLoad.svelte";
  import { getFilesFromDataTransfer } from "$lib/utils/files/drop";
  import type { QueuedFile } from "$lib/utils/files/queue";
  import type { TransferItem } from "$lib/utils/files/transferTypes";
  import { buildTree } from "$lib/utils/files/tree";
  import vibrate from "$lib/utils/vibrate";
  import DownloadMultipleIcon from "~icons/mdi/download-multiple";
  import FilePlusIcon from "~icons/mdi/file-plus";
  import FolderPlusIcon from "~icons/mdi/folder-plus";
  import PlusIcon from "~icons/mdi/plus";

  import FileDropZone from "./FileDropZone.svelte";
  import type { UnifiedItem } from "./fileTreeHelpers";

  interface Props {
    autoDownload: boolean;
    history: TransferItem[];
    queue: QueuedFile[];
    onPull?: (fileId: string) => void;
    onPullBatch?: (fileIds: string[], zipFilename?: string) => void;
    onDeleteHistory?: (fileId: string | string[]) => void;
    onadd: (files: FileList | File[] | { file: File; path: string }[]) => void;
    onremoveQueue: (id: string | string[]) => void;
    onclearQueue: () => void;
  }

  let {
    autoDownload,
    history,
    queue,
    onPull,
    onPullBatch,
    onDeleteHistory,
    onadd,
    onremoveQueue,
    onclearQueue,
  }: Props = $props();

  let pathStack = $state<string[]>([]);
  let dragOver = $state(false);

  let filePicker!: HTMLInputElement;
  let folderPicker!: HTMLInputElement;

  const unifiedList = $derived([
    ...queue.map((q) => ({ type: "queue" as const, item: q, path: q.path })),
    ...history.map((h) => ({ type: "history" as const, item: h, path: h.name })),
  ] satisfies UnifiedItem[]);

  const tree = $derived(buildTree(unifiedList, (item) => item.path));

  function resolveNodes(stack: string[]) {
    let current = tree;
    for (const segment of stack) {
      const found = current.find((n) => n.isDir && n.name === segment);
      if (found) current = Array.from(found.children.values());
      else return null;
    }
    return current;
  }

  const currentNodes = $derived(resolveNodes(pathStack) ?? []);

  $effect.pre(() => {
    if (unifiedList.length) lazyLoad.mark("fileTreeView");
  });

  $effect(() => {
    if (pathStack.length > 0 && resolveNodes(pathStack) === null) {
      pathStack = pathStack.slice(0, -1);
    }
  });

  const pendingReceivedCount = $derived(
    history.filter((item) => item.direction === "received" && item.status === "pending").length,
  );

  const pendingReceivedIds = $derived(
    history
      .filter((item) => item.direction === "received" && item.status === "pending")
      .map((item) => item.id),
  );

  function handleFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      vibrate.light();
      onadd(input.files);
    }
    input.value = "";
  }
</script>

<svelte:window
  ondragover={(e) => {
    e.preventDefault();
    dragOver = true;
  }}
  ondragleave={(e) => {
    if (e.clientX === 0 || e.clientY === 0) dragOver = false;
  }}
  ondrop={async (e) => {
    e.preventDefault();
    dragOver = false;
    if (e.dataTransfer?.items) {
      vibrate.light();
      const files = await getFilesFromDataTransfer(e.dataTransfer.items);
      if (files.length > 0) onadd(files);
    } else if (e.dataTransfer?.files.length) {
      vibrate.light();
      onadd(e.dataTransfer.files);
    }
  }} />

<FileDropZone {dragOver} />

<section class="card bg-base-100 dark:bg-base-300 col-span-full min-w-0 overflow-hidden shadow-sm">
  <div class="card-body min-w-0 gap-4">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex min-w-0 items-center gap-3">
        <h2 class="text-lg font-semibold">Arquivos</h2>
        {#if pathStack.length > 0}
          <button
            type="button"
            class="btn btn-ghost btn-xs text-base-content/70 hover:text-primary gap-1"
            onclick={() => {
              pathStack = pathStack.slice(0, -1);
            }}>
            ← Voltar
          </button>
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-2">
        {#if !autoDownload && pendingReceivedCount > 0}
          <button
            type="button"
            class="btn btn-ghost btn-accent btn-sm gap-1"
            onclick={() => onPullBatch?.(pendingReceivedIds)}>
            <DownloadMultipleIcon class="text-base" />
            Baixar todos
          </button>
        {/if}
        {#if queue.length > 0}
          <button
            class="btn btn-ghost btn-xs"
            onclick={onclearQueue}>Limpar fila</button>
        {/if}
        <button
          type="button"
          popovertarget="add-files-menu"
          style="anchor-name:--add-files-anchor"
          class="btn btn-primary btn-sm gap-1">
          <PlusIcon class="text-base" />
          Adicionar
        </button>
        <ul
          class="dropdown dropdown-end menu bg-base-100 rounded-box z-10 mt-2 w-52 p-2 shadow"
          popover
          id="add-files-menu"
          style="position-anchor:--add-files-anchor">
          <li class="mb-1">
            <button
              type="button"
              onclick={() => filePicker.click()}>
              <FilePlusIcon class="text-sm" />
              Selecionar Arquivos
            </button>
          </li>
          <li>
            <button
              type="button"
              onclick={() => folderPicker.click()}>
              <FolderPlusIcon class="text-sm" />
              Selecionar Pasta
            </button>
          </li>
        </ul>
      </div>
    </div>

    {#if !unifiedList.length}
      <div
        class="border-base-300 text-base-content/60 rounded-lg border-2 border-dashed p-10 text-center">
        <div class="flex justify-center">
          <button
            type="button"
            onclick={() => filePicker.click()}
            class="btn btn-ghost btn-circle p-1">
            <FilePlusIcon class="text-3xl opacity-50" />
          </button>
          <div class="divider divider-horizontal"></div>
          <button
            type="button"
            onclick={() => folderPicker.click()}
            class="btn btn-ghost btn-circle p-1">
            <FolderPlusIcon class="text-3xl opacity-50" />
          </button>
        </div>
        <p>Arraste arquivos e pastas para cá<br />ou clique em Adicionar</p>
      </div>
    {:else}
      {#if lazyLoad.has("fileTreeView")}
        {const FileTreeView = (await import("./FileTreeView.svelte")).default}
        <FileTreeView
          {pathStack}
          {currentNodes}
          {autoDownload}
          {onPull}
          {onPullBatch}
          {onDeleteHistory}
          {onremoveQueue}
          onNavigate={(newStack) => {
            pathStack = newStack;
          }} />
      {/if}
    {/if}
  </div>
</section>

<input
  bind:this={filePicker}
  type="file"
  multiple
  class="hidden"
  onchange={handleFiles} />

<input
  bind:this={folderPicker}
  type="file"
  webkitdirectory
  class="hidden"
  onchange={handleFiles} />

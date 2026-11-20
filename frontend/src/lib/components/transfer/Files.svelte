<script lang="ts">
  import { inject } from "quick-di";
  import { lazy } from "svelte-comp-lazyloader";
  import DownloadMultipleIcon from "~icons/mdi/download-multiple";
  import FilePlusIcon from "~icons/mdi/file-plus";
  import FolderPlusIcon from "~icons/mdi/folder-plus";
  import PlusIcon from "~icons/mdi/plus";

  import { PickerPort } from "#lib/ports/picker.js";
  import { transferStore } from "#lib/stores/transferStore.svelte.js";
  import { feedback } from "#lib/utils/feedback.js";
  import type { QueuedFile } from "#lib/utils/files/queue.js";
  import type { TransferItem } from "#lib/utils/files/transferTypes.js";
  import { activeDownloadId, buildTree, type UnifiedItem } from "#lib/utils/files/tree.js";

  import FileDropZone from "./FileDropZone.svelte";

  const FileTreeView = lazy(() => import("./FileTreeView.svelte"));

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

  const picker = inject(PickerPort);

  let navStack = $state<string[]>([]);

  let filePicker!: HTMLInputElement;
  let folderPicker!: HTMLInputElement;
  let addMenu!: HTMLUListElement;

  const unifiedList = $derived([
    ...queue.map((q) => ({ type: "queue" as const, item: q, path: q.path })),
    ...history.map((h) => ({ type: "history" as const, item: h, path: h.name })),
  ] satisfies UnifiedItem[]);

  const tree = $derived(buildTree(unifiedList, (item) => item.path));

  // The deepest folder of navStack that still exists, so removed folders fall back to a parent.
  const view = $derived.by(() => {
    let nodes = tree;
    for (const [index, segment] of navStack.entries()) {
      const dir = nodes.find((n) => n.isDir && n.name === segment);
      if (!dir) return { pathStack: navStack.slice(0, index), nodes };
      nodes = Array.from(dir.children.values());
    }
    return { pathStack: navStack, nodes };
  });

  const pathStack = $derived(view.pathStack);
  const currentNodes = $derived(view.nodes);

  const activeDownload = $derived(activeDownloadId(history));

  const pendingReceivedIds = $derived(transferStore.pendingReceived.map((item) => item.id));

  function handleFiles(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      feedback.light();
      onadd(input.files);
    }
    input.value = "";
  }

  async function add(kind: "files" | "folder") {
    addMenu.hidePopover();
    if (!picker.canPick) {
      (kind === "files" ? filePicker : folderPicker).click();
      return;
    }

    const picked = kind === "files" ? await picker.pickFiles() : await picker.pickFolder();
    if (!picked.length) return;

    feedback.light();
    onadd(picked);
  }
</script>

<FileDropZone onDrop={onadd} />

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
              navStack = pathStack.slice(0, -1);
            }}>
            ← Voltar
          </button>
        {/if}
      </div>
      <div class="flex flex-wrap items-center gap-2">
        {#if !autoDownload && pendingReceivedIds.length > 0}
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
          bind:this={addMenu}
          class="dropdown dropdown-end menu bg-base-100 rounded-box z-10 mt-2 w-52 p-2 shadow"
          popover
          id="add-files-menu"
          style="position-anchor:--add-files-anchor">
          <li class="mb-1">
            <button
              type="button"
              onclick={() => add("files")}>
              <FilePlusIcon class="text-sm" />
              Selecionar Arquivos
            </button>
          </li>
          <li>
            <button
              type="button"
              onclick={() => add("folder")}>
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
            onclick={() => add("files")}
            class="btn btn-ghost btn-circle p-1">
            <FilePlusIcon class="text-3xl opacity-50" />
          </button>
          <div class="divider divider-horizontal"></div>
          <button
            type="button"
            onclick={() => add("folder")}
            class="btn btn-ghost btn-circle p-1">
            <FolderPlusIcon class="text-3xl opacity-50" />
          </button>
        </div>
        <p>
          {#if picker.canPick}
            Clique em Adicionar para escolher arquivos e pastas
          {:else}
            Arraste arquivos e pastas para cá<br />ou clique em Adicionar
          {/if}
        </p>
      </div>
    {:else}
      <FileTreeView
        {pathStack}
        {currentNodes}
        {autoDownload}
        activeDownloadId={activeDownload}
        {onPull}
        {onPullBatch}
        {onDeleteHistory}
        {onremoveQueue}
        onNavigate={(newStack) => {
          navStack = newStack;
        }} />
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

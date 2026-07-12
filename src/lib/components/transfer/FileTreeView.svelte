<script lang="ts">
  import Breadcrumb from "$lib/components/ui/Breadcrumb.svelte";
  import { formatBytes } from "$lib/utils/files/format";
  import type { TreeNode } from "$lib/utils/files/tree";
  import CloseIcon from "~icons/mdi/close";
  import FileIcon from "~icons/mdi/file";
  import FileDownloadIcon from "~icons/mdi/file-download";
  import FolderIcon from "~icons/mdi/folder";
  import FolderDownloadIcon from "~icons/mdi/folder-download";

  import FileTreeActionsModal, { type FileTreeAction } from "./FileTreeActionsModal.svelte";
  import {
    canDelete,
    canDeleteFolder,
    filePercent,
    folderProgress,
    getDeletableIds,
    getFolderPendingReceivedIds,
    hasPendingReceived,
    type UnifiedItem,
  } from "./fileTreeHelpers";

  interface Props {
    pathStack: string[];
    currentNodes: TreeNode<UnifiedItem>[];
    autoDownload: boolean;
    onPull?: (fileId: string) => void;
    onPullBatch?: (fileIds: string[], zipFilename?: string) => void;
    onDeleteHistory?: (fileId: string | string[]) => void;
    onremoveQueue: (id: string | string[]) => void;
    onNavigate: (newStack: string[]) => void;
  }

  let {
    pathStack,
    currentNodes,
    autoDownload,
    onPull,
    onPullBatch,
    onDeleteHistory,
    onremoveQueue,
    onNavigate,
  }: Props = $props();

  function handleRemoveNode(node: TreeNode<UnifiedItem>) {
    const { queueIds, historyIds } = getDeletableIds(node);
    if (queueIds.length > 0) onremoveQueue(queueIds);
    if (historyIds.length > 0) onDeleteHistory?.(historyIds);
  }

  let contextNode = $state<TreeNode<UnifiedItem> | null>(null);
  let contextActions = $state<FileTreeAction[]>([]);
  let contextMenuOpen = $state(false);

  const contextNodeName = $derived(contextNode?.name ?? "");

  function getNodeActions(node: TreeNode<UnifiedItem>): FileTreeAction[] {
    const actions: FileTreeAction[] = [];

    if (node.isDir) {
      if (hasPendingReceived(node)) {
        actions.push({ id: "download-folder", label: "Baixar pasta" });
      }
      if (canDeleteFolder(node)) {
        actions.push({ id: "remove", label: "Remover" });
      }
    } else {
      const u = node.item!;
      if (
        u.type === "history" &&
        u.item.direction === "received" &&
        u.item.status === "pending" &&
        !autoDownload
      ) {
        actions.push({ id: "download", label: "Baixar" });
      }
      if (canDelete(u)) {
        actions.push({ id: "remove", label: "Remover" });
      }
    }

    return actions;
  }

  function handleContextMenu(event: MouseEvent, node: TreeNode<UnifiedItem>) {
    const actions = getNodeActions(node);
    if (!actions.length) return;

    event.preventDefault();
    contextNode = node;
    contextActions = actions;
    contextMenuOpen = true;
  }

  function handleContextAction(id: FileTreeAction["id"]) {
    const node = contextNode;
    if (!node) return;

    switch (id) {
      case "download": {
        const u = node.item;
        if (u?.type === "history") onPull?.(u.item.id);
        break;
      }
      case "download-folder":
        if (node.isDir) {
          onPullBatch?.(getFolderPendingReceivedIds(node), `${node.name}.zip`);
        }
        break;
      case "remove":
        handleRemoveNode(node);
        break;
    }
  }

  function closeContextMenu() {
    contextMenuOpen = false;
    setTimeout(() => {
      contextNode = null;
      contextActions = [];
    }, 300);
  }
</script>

{#snippet treeNode(node: TreeNode<UnifiedItem>, _depth: number)}
  {#if node.isDir}
    {@const progress = folderProgress(node)}
    <li class="border-base-300 flex flex-col border-b py-1 last:border-b-0">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="hover:bg-base-200 group flex min-w-0 cursor-pointer items-center gap-2 px-3 py-2 transition-colors"
        onclick={() => {
          onNavigate(node.path.split("/"));
        }}
        oncontextmenu={(event) => handleContextMenu(event, node)}>
        <FolderIcon class="text-primary shrink-0 text-lg" />
        <span class="flex-1 truncate font-medium">{node.name}</span>
        <div class="hidden shrink-0 items-center gap-2 sm:flex">
          {#if hasPendingReceived(node)}
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square text-accent tooltip tooltip-left"
              data-tip="Baixar pasta"
              aria-label="Baixar pasta {node.name}"
              onclick={(e) => {
                e.stopPropagation();
                onPullBatch?.(getFolderPendingReceivedIds(node), `${node.name}.zip`);
              }}>
              <FolderDownloadIcon class="text-base" />
            </button>
          {/if}
          {#if canDeleteFolder(node)}
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square text-error tooltip tooltip-left opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              data-tip="Remover"
              aria-label="Remover pasta {node.name}"
              onclick={(e) => {
                e.stopPropagation();
                handleRemoveNode(node);
              }}>
              <CloseIcon class="text-base" />
            </button>
          {/if}
        </div>
      </div>
      {#if progress.downloading}
        <div class="px-3 pb-2">
          <progress
            class="progress progress-secondary w-full"
            value={progress.percent}
            max="100"></progress>
        </div>
      {/if}
    </li>
  {:else}
    {@const u = node.item!}
    <li
      class="group hover:bg-base-200 border-base-300 min-w-0 space-y-1 border-b px-3 py-3 transition-colors last:border-b-0"
      oncontextmenu={(event) => handleContextMenu(event, node)}>
      <div class="flex min-w-0 items-start justify-between gap-2 text-sm">
        <div class="flex min-w-0 flex-1 items-start gap-2">
          <FileIcon class="text-base-content/50 mt-0.5 shrink-0 text-base" />
          <div class="min-w-0">
            <p class="truncate font-medium">{node.name}</p>
            {#if u.type === "queue"}
              <p class="text-base-content/60 text-xs">A enviar · {formatBytes(u.item.file.size)}</p>
            {:else}
              <p class="text-base-content/60 text-xs">
                {#if u.item.status === "pending"}
                  {u.item.direction === "sent" ? "Pronto para enviar" : "Pronto para receber"} · {formatBytes(
                    u.item.size,
                  )}
                {:else}
                  {u.item.direction === "sent" ? "Enviado" : "Recebido"} · {formatBytes(
                    u.item.size,
                  )}
                {/if}
              </p>
            {/if}
          </div>
        </div>
        <div class="hidden shrink-0 items-center gap-2 sm:flex">
          {#if u.type === "history"}
            {#if u.item.direction === "received" && u.item.status === "pending" && !autoDownload}
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square tooltip tooltip-left"
                data-tip="Baixar"
                aria-label="Baixar {node.name}"
                onclick={() => onPull?.(u.item.id)}>
                <FileDownloadIcon class="text-accent text-base" />
              </button>
            {/if}
          {/if}
          {#if canDelete(u)}
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square text-error tooltip tooltip-left opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
              data-tip="Remover"
              aria-label="Remover {node.name}"
              onclick={() => {
                if (u.type === "queue") onremoveQueue(u.item.id);
                else onDeleteHistory?.(u.item.id);
              }}>
              <CloseIcon class="text-base" />
            </button>
          {/if}
          <span class="text-base-content/60 hidden w-16 shrink-0 text-right text-xs sm:block">
            {#if u.type === "queue"}
              0 B<br />{formatBytes(u.item.file.size)}
            {:else}
              {formatBytes(u.item.bytesTransferred)}<br />{formatBytes(u.item.size)}
            {/if}
          </span>
        </div>
      </div>
      <div>
        <progress
          class="progress progress-secondary w-full"
          class:progress-success={u.type === "history" && u.item.status === "completed"}
          value={u.type === "queue" ? 0 : filePercent(u.item)}
          max="100"></progress>
      </div>
    </li>
  {/if}
{/snippet}

<Breadcrumb
  {pathStack}
  onnavigate={onNavigate} />
<ul
  class="border-base-300 flex max-h-96 min-w-0 scrollbar-thin flex-col overflow-x-hidden overflow-y-auto border-t border-b select-none">
  {#each currentNodes as node (node.path)}
    {@render treeNode(node, 0)}
  {/each}
</ul>

<FileTreeActionsModal
  open={contextMenuOpen}
  name={contextNodeName}
  actions={contextActions}
  onSelect={handleContextAction}
  onClose={closeContextMenu} />

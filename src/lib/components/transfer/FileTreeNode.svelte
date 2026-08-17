<script lang="ts">
  import Breadcrumb from "#lib/components/ui/Breadcrumb.svelte";
  import {
    canShowFileDownload,
    unifiedFileSubtitle,
    unifiedSizeDisplay,
  } from "#lib/utils/files/fileTreeDisplay.js";
  import { filePercent, folderProgress, type UnifiedItem } from "#lib/utils/files/tree.js";
  import type { TreeNode } from "#lib/utils/files/tree.js";
  import CloseIcon from "~icons/mdi/close";
  import FileIcon from "~icons/mdi/file";
  import FileDownloadIcon from "~icons/mdi/file-download";
  import FolderIcon from "~icons/mdi/folder";
  import FolderDownloadIcon from "~icons/mdi/folder-download";

  import type { FileTreeAction } from "./FileTreeActionsModal.svelte";

  interface Props {
    node: TreeNode<UnifiedItem>;
    autoDownload: boolean;
    onPull?: (fileId: string) => void;
    onPullBatch?: (fileIds: string[], zipFilename?: string) => void;
    onDeleteHistory?: (fileId: string | string[]) => void;
    onremoveQueue: (id: string | string[]) => void;
    onNavigate: (newStack: string[]) => void;
    onContextMenu: (event: MouseEvent, node: TreeNode<UnifiedItem>) => void;
    onRemoveNode: (node: TreeNode<UnifiedItem>) => void;
    canDeleteFolder: (node: TreeNode<UnifiedItem>) => boolean;
    hasPendingReceived: (node: TreeNode<UnifiedItem>) => boolean;
    getFolderPendingReceivedIds: (node: TreeNode<UnifiedItem>) => string[];
    canDelete: (u: UnifiedItem) => boolean;
  }

  let {
    node,
    autoDownload,
    onPull,
    onPullBatch,
    onDeleteHistory,
    onremoveQueue,
    onNavigate,
    onContextMenu,
    onRemoveNode,
    canDeleteFolder,
    hasPendingReceived,
    getFolderPendingReceivedIds,
    canDelete,
  }: Props = $props();
</script>

{#if node.isDir}
  {const progress = $derived(folderProgress(node))}
  <li class="border-base-300 flex flex-col border-b py-1 last:border-b-0">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="hover:bg-base-200 group flex min-w-0 cursor-pointer items-center gap-2 px-3 py-2 transition-colors"
      onclick={() => onNavigate(node.path.split("/"))}
      oncontextmenu={(event) => onContextMenu(event, node)}>
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
              onRemoveNode(node);
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
  {const u = $derived(node.item!)}
  {const fileProgress = $derived(u.type === "queue" ? 0 : filePercent(u.item))}
  <li
    class="group hover:bg-base-200 border-base-300 min-w-0 space-y-1 border-b px-3 py-3 transition-colors last:border-b-0"
    oncontextmenu={(event) => onContextMenu(event, node)}>
    <div class="flex min-w-0 items-start justify-between gap-2 text-sm">
      <div class="flex min-w-0 flex-1 items-start gap-2">
        <FileIcon class="text-base-content/50 mt-0.5 shrink-0 text-base" />
        <div class="min-w-0">
          <p class="truncate font-medium">{node.name}</p>
          <p class="text-base-content/60 text-xs">{unifiedFileSubtitle(u)}</p>
        </div>
      </div>
      <div class="hidden shrink-0 items-center gap-2 sm:flex">
        {#if canShowFileDownload(u, autoDownload)}
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square tooltip tooltip-left"
            data-tip="Baixar"
            aria-label="Baixar {node.name}"
            onclick={() => onPull?.(u.item.id)}>
            <FileDownloadIcon class="text-accent text-base" />
          </button>
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
        <span
          class="text-base-content/60 hidden w-16 shrink-0 text-right text-xs whitespace-pre-line sm:block">
          {unifiedSizeDisplay(u)}
        </span>
      </div>
    </div>
    <div>
      <progress
        class="progress progress-secondary w-full"
        class:progress-success={u.type === "history" && u.item.status === "completed"}
        value={fileProgress}
        max="100"></progress>
    </div>
  </li>
{/if}

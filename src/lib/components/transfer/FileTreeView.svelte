<script lang="ts">
  import Breadcrumb from "$lib/components/ui/Breadcrumb.svelte";
  import {
    canDelete,
    canDeleteFolder,
    getDeletableIds,
    getFolderPendingReceivedIds,
    hasPendingReceived,
    type UnifiedItem,
  } from "$lib/utils/files/tree";
  import type { TreeNode } from "$lib/utils/files/tree";

  import FileTreeActionsModal, { type FileTreeAction } from "./FileTreeActionsModal.svelte";
  import FileTreeNode from "./FileTreeNode.svelte";

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

<Breadcrumb
  {pathStack}
  onnavigate={onNavigate} />
<ul
  class="border-base-300 flex max-h-96 min-w-0 scrollbar-thin flex-col overflow-x-hidden overflow-y-auto border-t border-b select-none">
  {#each currentNodes as node (node.path)}
    <FileTreeNode
      {node}
      {autoDownload}
      {onPull}
      {onPullBatch}
      {onDeleteHistory}
      {onremoveQueue}
      {onNavigate}
      onContextMenu={handleContextMenu}
      onRemoveNode={handleRemoveNode}
      {canDeleteFolder}
      {hasPendingReceived}
      {getFolderPendingReceivedIds}
      {canDelete} />
  {/each}
</ul>

<FileTreeActionsModal
  open={contextMenuOpen}
  name={contextNodeName}
  actions={contextActions}
  onSelect={handleContextAction}
  onClose={closeContextMenu} />

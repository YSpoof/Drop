export type TreeNode<T> = {
  name: string;
  path: string;
  isDir: boolean;
  item?: T;
  children: Map<string, TreeNode<T>>;
};

export function buildTree<T>(items: T[], getPath: (item: T) => string): TreeNode<T>[] {
  const root: TreeNode<T> = { name: "", path: "", isDir: true, children: new Map() };

  for (const item of items) {
    const fullPath = getPath(item);
    // If it's an absolute path or has leading slashes, clean it up
    const parts = fullPath.replace(/^\/+/, "").split("/");
    let current = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue; // skip empty parts
      const isFile = i === parts.length - 1;
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: currentPath,
          isDir: !isFile,
          children: new Map(),
          item: isFile ? item : undefined,
        });
      } else if (isFile && !current.children.get(part)!.item) {
        // Just in case it was created as a dir previously
        current.children.get(part)!.item = item;
      }
      current = current.children.get(part)!;
    }
  }

  function sortNodes(node: TreeNode<T>) {
    const sorted = Array.from(node.children.values()).sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
    node.children = new Map(sorted.map((n) => [n.name, n]));
    for (const child of sorted) {
      if (child.isDir) sortNodes(child);
    }
  }

  sortNodes(root);
  return Array.from(root.children.values());
}

export function getTreeFileIds<T extends { id: string }>(node: TreeNode<T>): string[] {
  if (!node.isDir && node.item) return [node.item.id];
  return Array.from(node.children.values()).flatMap((child) =>
    getTreeFileIds(child as TreeNode<T>),
  );
}

// === Integrated from fileTreeHelpers.ts ===

import type { QueuedFile } from "$lib/utils/files/queue";
import type { TransferItem } from "$lib/utils/files/transferTypes";

export type UnifiedItem =
  | { type: "queue"; item: QueuedFile; path: string }
  | { type: "history"; item: TransferItem; path: string };

export function filePercent(item: TransferItem) {
  if (item.status === "pending") return 0;
  if (item.size <= 0) return item.status === "completed" ? 100 : 0;
  return Math.min(100, (item.bytesTransferred / item.size) * 100);
}

export function canDelete(u: UnifiedItem) {
  if (u.type === "queue") return true;
  return u.item.status === "pending" || u.item.status === "in-progress";
}

/**
 * Helper to traverse the tree and aggregate results from files
 * Reduces the need for multiple recursive functions.
 */
function walkTree<T>(node: TreeNode<UnifiedItem>, fn: (item: UnifiedItem) => T[]): T[] {
  if (!node.isDir && node.item) return fn(node.item);
  return Array.from(node.children.values()).flatMap((child) => walkTree(child, fn));
}

export function canDeleteFolder(node: TreeNode<UnifiedItem>): boolean {
  return walkTree(node, (u) => (canDelete(u) ? [true] : [])).length > 0;
}

export function getDeletableIds(node: TreeNode<UnifiedItem>): {
  queueIds: string[];
  historyIds: string[];
} {
  const result = { queueIds: [] as string[], historyIds: [] as string[] };
  walkTree(node, (u) => {
    if (canDelete(u)) {
      if (u.type === "queue") result.queueIds.push(u.item.id);
      else result.historyIds.push(u.item.id);
    }
    return [];
  });
  return result;
}

const isPendingReceived = (u: UnifiedItem) =>
  u.type === "history" && u.item.direction === "received" && u.item.status === "pending";

export function getFolderPendingReceivedIds(node: TreeNode<UnifiedItem>): string[] {
  return walkTree(node, (u) => (isPendingReceived(u) ? [u.item.id] : []));
}

export function hasPendingReceived(node: TreeNode<UnifiedItem>): boolean {
  return walkTree(node, (u) => (isPendingReceived(u) ? [true] : [])).length > 0;
}

/** Computes aggregate download progress for a folder of files */
export function folderProgress(node: TreeNode<UnifiedItem>) {
  let bytesTransferred = 0;
  let size = 0;
  let hasInProgress = false;

  walkTree(node, (u) => {
    if (u.type === "history" && u.item.direction === "received") {
      const item = u.item;
      if (
        item.status === "in-progress" ||
        item.status === "completed" ||
        item.status === "failed"
      ) {
        bytesTransferred += item.bytesTransferred;
        size += item.size;
        if (item.status === "in-progress") hasInProgress = true;
      }
    }
    return [];
  });

  if (size <= 0) return { percent: 0, downloading: false };
  const percent = Math.min(100, (bytesTransferred / size) * 100);
  const downloading = hasInProgress || (percent > 0 && percent < 100);
  return { percent, downloading };
}

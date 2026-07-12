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

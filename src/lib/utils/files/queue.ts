export interface QueuedFile {
  id: string;
  file: File;
  groupId: string;
  zip: boolean;
  path: string;
}

export function createQueuedFile(
  file: File,
  path = file.webkitRelativePath || file.name,
  groupId = crypto.randomUUID(),
): QueuedFile {
  return { id: crypto.randomUUID(), file, groupId, zip: false, path };
}

export function createQueuedFiles(
  files: FileList | File[] | { file: File; path: string }[],
): QueuedFile[] {
  const groupId = crypto.randomUUID();
  const items = [...files].map((item) => {
    if ("path" in item && "file" in item && !(item instanceof File)) {
      return createQueuedFile(item.file, item.path, groupId);
    }
    const file = item as File;
    return createQueuedFile(file, file.webkitRelativePath || file.name, groupId);
  });
  if (items.length > 1) {
    for (const item of items) {
      item.zip = true;
    }
  }
  return items;
}

export function totalQueueBytes(queue: QueuedFile[]): number {
  return queue.reduce((sum, item) => sum + item.file.size, 0);
}

export interface DroppedFile {
  file: File;
  path: string;
}

export async function getFilesFromDataTransfer(
  items: DataTransferItemList,
): Promise<DroppedFile[]> {
  const files: DroppedFile[] = [];
  const promises: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "file") {
      const entry = item.webkitGetAsEntry();
      if (entry) {
        promises.push(traverseEntry(entry, "", files));
      } else {
        const file = item.getAsFile();
        if (file) files.push({ file, path: file.name });
      }
    }
  }
  await Promise.all(promises);
  return files;
}

async function traverseEntry(
  entry: FileSystemEntry,
  path: string,
  files: DroppedFile[],
): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const { promise, resolve } = Promise.withResolvers<void>();
    fileEntry.file((file) => {
      const relativePath = path ? `${path}/${file.name}` : file.name;
      files.push({ file, path: relativePath });
      resolve();
    });
    return promise;
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const dirReader = dirEntry.createReader();
    const newPath = path ? `${path}/${dirEntry.name}` : dirEntry.name;

    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const readEntries = () => {
      dirReader.readEntries(async (entries) => {
        if (entries.length === 0) {
          resolve();
        } else {
          const promises = entries.map((e) => traverseEntry(e, newPath, files));
          await Promise.all(promises);
          readEntries();
        }
      }, reject);
    };
    readEntries();
    return promise;
  }
}

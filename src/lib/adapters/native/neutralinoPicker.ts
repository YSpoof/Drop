import { os } from "@neutralinojs/lib";

import { leafOf, readEntries, tryStats } from "#lib/adapters/native/neutralinoFs.js";
import type { PickedFile, PickerPort } from "#lib/ports/picker.js";

/**
 * A File carrying only metadata; the bytes are read straight from `path` by the sender.
 * The webview never sees real paths, so native dialogs are the only source of them.
 */
async function fileShell(absPath: string, relativePath: string): Promise<PickedFile | null> {
  const stats = await tryStats(absPath);
  if (!stats || stats.isDirectory) return null;

  const file = Object.assign(new File([], leafOf(absPath), { lastModified: stats.modifiedAt }), {
    path: absPath,
  });

  Object.defineProperty(file, "size", { value: stats.size, configurable: true });

  return { file, path: relativePath };
}

async function collect(dir: string, relativeDir: string, into: PickedFile[]): Promise<void> {
  for (const entry of await readEntries(dir)) {
    const relativePath = `${relativeDir}/${entry.entry}`;

    if (entry.type === "DIRECTORY") {
      await collect(entry.path, relativePath, into);
      continue;
    }

    const picked = await fileShell(entry.path, relativePath);
    if (picked) into.push(picked);
  }
}

export class NeutralinoPicker implements PickerPort {
  readonly canPick = true;

  async pickFiles(): Promise<PickedFile[]> {
    const selected = await os.showOpenDialog("Selecionar arquivos", { multiSelections: true });

    const picked: PickedFile[] = [];
    for (const absPath of selected) {
      const entry = await fileShell(absPath, leafOf(absPath));
      if (entry) picked.push(entry);
    }
    return picked;
  }

  async pickFolder(): Promise<PickedFile[]> {
    const folderPath = await os.showFolderDialog("Selecionar pasta");
    if (!folderPath) return [];

    const picked: PickedFile[] = [];
    await collect(folderPath, leafOf(folderPath), picked);
    return picked;
  }
}

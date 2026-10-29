import { callRpc } from "#lib/adapters/native/goNativeClient.js";
import { PickerPort, type PickedFile } from "#lib/ports/picker.js";

type StatResult = {
  exists: boolean;
  path: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: number;
};

type DirEntry = {
  entry: string;
  path: string;
  type: string;
  size: number;
  modifiedAt: number;
};

function leafOf(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const sep = trimmed.includes("\\") ? "\\" : "/";
  return trimmed.slice(trimmed.lastIndexOf(sep) + 1);
}

async function fileShell(absPath: string, relativePath: string): Promise<PickedFile | null> {
  const stat = await callRpc<StatResult>("fs.stat", { path: absPath });
  if (!stat.exists || stat.isDirectory) return null;

  const file = Object.assign(new File([], leafOf(absPath), { lastModified: stat.modifiedAt }), {
    path: absPath,
  });

  Object.defineProperty(file, "size", { value: stat.size, configurable: true });

  return { file, path: relativePath };
}

async function collect(dir: string, relativeDir: string, into: PickedFile[]): Promise<void> {
  try {
    const entries = await callRpc<DirEntry[]>("fs.readDir", { path: dir });
    for (const entry of entries) {
      if (entry.entry.startsWith(".")) continue;
      const relativePath = `${relativeDir}/${entry.entry}`;

      if (entry.type === "DIRECTORY") {
        await collect(entry.path, relativePath, into);
        continue;
      }

      const picked = await fileShell(entry.path, relativePath);
      if (picked) into.push(picked);
    }
  } catch {
    // Ignore read errors
  }
}

export class GoNativePicker extends PickerPort {
  readonly canPick = true;

  async pickFiles(): Promise<PickedFile[]> {
    const selected = await callRpc<string[]>("dialog.pickFiles", {
      title: "Selecionar arquivos",
    });
    if (!selected) return [];

    const picked: PickedFile[] = [];
    for (const absPath of selected) {
      const entry = await fileShell(absPath, leafOf(absPath));
      if (entry) picked.push(entry);
    }
    return picked;
  }

  async pickFolder(): Promise<PickedFile[]> {
    const folderPath = await callRpc<string>("dialog.pickFolder", {
      title: "Selecionar pasta",
    });
    if (!folderPath) return [];

    const picked: PickedFile[] = [];
    await collect(folderPath, leafOf(folderPath), picked);
    return picked;
  }
}

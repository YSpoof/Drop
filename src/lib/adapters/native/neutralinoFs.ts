import { filesystem } from "@neutralinojs/lib";

/** `getStats` throws `NE_FS_NOPATHE` for missing or inaccessible paths. */
export async function tryStats(path: string) {
  try {
    return await filesystem.getStats(path);
  } catch {
    return null;
  }
}

/** Directory contents without `.`, `..` and dotfiles, matching the old chokidar filter. */
export async function readEntries(dir: string) {
  try {
    const entries = await filesystem.readDirectory(dir);
    return entries.filter((entry) => !entry.entry.startsWith("."));
  } catch {
    return [];
  }
}

export function separatorOf(path: string): string {
  return path.includes("\\") ? "\\" : "/";
}

/** Last segment of a path, ignoring trailing separators. */
export function leafOf(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const separator = separatorOf(trimmed);
  return trimmed.slice(trimmed.lastIndexOf(separator) + 1);
}

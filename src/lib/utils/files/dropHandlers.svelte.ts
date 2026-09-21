import { environment } from "#lib/runtime.js";
import { feedback } from "#lib/utils/feedback.js";
import { getFilesFromDataTransfer } from "#lib/utils/files/drop.js";

export type FileDropHandler = (files: FileList | File[] | { file: File; path: string }[]) => void;

export function createDropHandlers(getOnDrop: () => FileDropHandler) {
  let dragOver = $state(false);

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragOver = false;
    // Dropped files carry no real disk path in the native shell, so the queue can't read them.
    if (environment.isNative) return;
    if (event.dataTransfer?.items) {
      feedback.light();
      const files = await getFilesFromDataTransfer(event.dataTransfer.items);
      if (files.length > 0) getOnDrop()(files);
    } else if (event.dataTransfer?.files.length) {
      feedback.light();
      getOnDrop()(event.dataTransfer.files);
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    dragOver = true;
  }

  function handleDragLeave(event: DragEvent) {
    if (event.clientX === 0 || event.clientY === 0) dragOver = false;
  }

  return {
    get dragOver() {
      return dragOver;
    },
    handleDrop,
    handleDragOver,
    handleDragLeave,
  };
}

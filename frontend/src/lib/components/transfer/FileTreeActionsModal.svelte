<script lang="ts">
  import CloseIcon from "~icons/mdi/close";
  import FileDownloadIcon from "~icons/mdi/file-download";
  import FolderDownloadIcon from "~icons/mdi/folder-download";

  import GenericModal from "#lib/components/ui/GenericModal.svelte";

  export type FileTreeAction = {
    id: "download" | "download-folder" | "remove";
    label: string;
  };

  interface Props {
    open: boolean;
    name: string;
    actions: FileTreeAction[];
    onSelect: (id: FileTreeAction["id"]) => void;
    onClose: () => void;
  }

  let { open, name, actions, onSelect, onClose }: Props = $props();

  function actionClass(id: FileTreeAction["id"]) {
    switch (id) {
      case "remove":
        return "btn-error";
      case "download":
      case "download-folder":
        return "btn-accent";
    }
  }

  function handleSelect(id: FileTreeAction["id"]) {
    onSelect(id);
    onClose();
  }
</script>

<GenericModal
  {open}
  title={name}
  {onClose}
  modalClass="sm:min-w-54"
  ><div class="space-y-2">
    {#each actions as action (action.id)}
      <button
        type="button"
        class="btn-block btn btn-soft flex items-center gap-2 {actionClass(action.id)}"
        onclick={() => handleSelect(action.id)}>
        {#if action.id === "download"}
          <FileDownloadIcon class="text-base" />
        {:else if action.id === "download-folder"}
          <FolderDownloadIcon class="text-base" />
        {:else}
          <CloseIcon class="text-base" />
        {/if}
        {action.label}
      </button>
    {/each}
  </div>
</GenericModal>

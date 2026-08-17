<script lang="ts">
  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import CloseIcon from "~icons/mdi/close";
  import FileDownloadIcon from "~icons/mdi/file-download";
  import FolderDownloadIcon from "~icons/mdi/folder-download";

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
        class="btn-block btn btn-soft flex items-center gap-2 {action.id === 'remove'
          ? 'btn-error'
          : action.id.includes('download')
            ? 'btn-accent'
            : ''}"
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

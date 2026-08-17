<script lang="ts">
  import GenericModal from "#lib/components/ui/GenericModal.svelte";
  import AlertCircleIcon from "~icons/mdi/alert-circle";
  import CheckCircleIcon from "~icons/mdi/check-circle";

  type RoomJoinPhase = "waiting" | "connecting" | "connected" | "failed";

  interface Props {
    open: boolean;
    phase: RoomJoinPhase;
    peerName?: string | null;
    onClose: () => void;
  }

  let { open, phase, peerName = null, onClose }: Props = $props();

  const title = $derived.by(() => {
    switch (phase) {
      case "connected":
        return "Conectado";
      case "connecting":
        return "Conectando";
      case "failed":
        return "Falha na conexão";
      case "waiting":
        return "Aguardando";
    }
  });

  function handleReconnect() {
    globalThis.location.reload();
  }
</script>

<GenericModal
  {open}
  {title}
  cantClose={true}
  {onClose}>
  {#if phase === "waiting"}
    <div class="flex flex-col items-center gap-3 py-4">
      <span class="loading loading-ring loading-lg text-primary"></span>
      <p class="text-base-content/80 text-center text-sm text-balance">
        Aguardando o outro usuário…
      </p>
    </div>
  {:else if phase === "connecting"}
    <div class="flex flex-col items-center gap-3 py-4">
      <span class="loading loading-ring loading-lg text-primary"></span>
      <p class="text-base-content/80 text-center text-sm text-balance">Conectando…</p>
    </div>
  {:else if phase === "failed"}
    <div
      role="alert"
      class="alert alert-soft alert-error alert-vertical sm:alert-horizontal">
      <AlertCircleIcon class="text-2xl" />
      <p class="text-pretty">
        A conexão automática falhou, verifique se a outra pessoa está no mesmo link que você.
      </p>
    </div>
  {:else}
    <div
      role="alert"
      class="alert alert-soft alert-success alert-vertical sm:alert-horizontal">
      <CheckCircleIcon class="text-2xl" />
      <p class="text-balance">
        {#if peerName}
          Conectado com <span class="font-semibold">{peerName}</span>
        {:else}
          Conectado
        {/if}.
      </p>
    </div>
  {/if}

  {#snippet modalActions()}
    {#if phase === "failed"}
      <button
        class="btn btn-primary"
        onclick={handleReconnect}>Reconectar</button>
    {/if}
  {/snippet}
</GenericModal>

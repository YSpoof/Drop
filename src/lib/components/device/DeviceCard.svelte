<script lang="ts">
  import type { PeerInfo } from "$lib/utils/signaling/types";
  import { feedback } from "$lib/utils/feedback";
  import CloudOutlineIcon from "~icons/mdi/cloud-outline";
  import TransitConnectionHorizontalIcon from "~icons/mdi/transit-connection-horizontal";
  import WifiIcon from "~icons/mdi/wifi";

  interface Props {
    peer: PeerInfo;
    connecting?: boolean;
    connected?: boolean;
    onConnect: (peerId: string) => void;
    onDisconnect?: () => void;
    disabled?: boolean;
  }

  let {
    peer,
    connecting = false,
    connected = false,
    onConnect,
    onDisconnect,
    disabled = false,
  }: Props = $props();

  function handleConnect() {
    feedback.light();
    onConnect(peer.peerId);
  }

  function handleDisconnect() {
    feedback.medium();
    onDisconnect?.();
  }
</script>

<div class="card bg-base-100 dark:bg-base-300 shadow-sm">
  <div class="card-body gap-2 p-4">
    <div class="flex items-start justify-between gap-2">
      <div>
        <div class="flex items-center gap-1.5">
          {#if peer.nearby}
            <div
              class="tooltip tooltip-right"
              data-tip="Na sua rede local">
              <WifiIcon
                class="text-accent text-base"
                aria-hidden="true" />
            </div>
          {:else}
            <div
              class="tooltip"
              data-tip="Remoto">
              <CloudOutlineIcon
                class="text-info text-base"
                aria-hidden="true" />
            </div>
          {/if}
          <h3 class="font-semibold">{peer.displayName}</h3>
        </div>
        <p class="text-base-content/60 text-sm">{peer.deviceHint}</p>
      </div>
      {#if connecting}
        <div
          class="tooltip tooltip-left"
          data-tip="Conectando">
          <span class="loading loading-ring loading-lg"></span>
        </div>
      {:else if connected}
        <div
          class="tooltip tooltip-left"
          data-tip="Conectado">
          <TransitConnectionHorizontalIcon class="text-success text-lg" />
        </div>
      {/if}
    </div>
    {#if connected}
      <button
        class="btn btn-error btn-sm"
        onclick={handleDisconnect}>
        Desconectar
      </button>
    {:else}
      <button
        class="btn btn-primary btn-sm"
        disabled={connecting || disabled}
        onclick={handleConnect}>
        Conectar
      </button>
    {/if}
  </div>
</div>

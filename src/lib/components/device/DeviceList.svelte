<script lang="ts">
  import DeviceCard from "$lib/components/device/DeviceCard.svelte";
  import type { PeerInfo } from "$lib/utils/signaling/types";
  import RadioTowerIcon from "~icons/mdi/radio-tower";

  interface Props {
    peers: PeerInfo[];
    inRoom?: boolean;
    pollingStopped?: boolean;
    connectingPeerId?: string | null;
    connectedPeerId?: string | null;
    connected?: boolean;
    onConnect: (peerId: string) => void;
    onDisconnect?: () => void;
  }

  let {
    peers,
    inRoom = false,
    pollingStopped = false,
    connectingPeerId = null,
    connectedPeerId = null,
    connected = false,
    onConnect,
    onDisconnect,
  }: Props = $props();

  const connecting = $derived(!!connectedPeerId);
</script>

<section class="card bg-base-100 dark:bg-base-300 min-w-0 space-y-3 overflow-hidden p-4 shadow-sm">
  <div class="flex justify-between">
    <div class="flex items-center gap-2">
      <RadioTowerIcon class="text-primary text-lg" />
      <h2 class="text-lg font-semibold">
        {#if connected}
          Pronto para transferir
        {:else}
          Dispositivos disponíveis
        {/if}
      </h2>
    </div>
  </div>
  {#if !peers.length}
    {#if pollingStopped}
      <p class="text-base-content/60 text-sm">
        Busca por dispositivos {inRoom ? "via link remoto" : "na sua rede local"} pausada.
      </p>
    {:else}
      <p class="text-base-content/60 skeleton skeleton-text text-sm">
        Procurando por dispositivos {inRoom ? "via link remoto" : "na sua rede local"}...
      </p>
    {/if}
  {:else}
    <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {#each peers as peer (peer.peerId)}
        <DeviceCard
          {peer}
          disabled={connecting}
          connecting={connectingPeerId === peer.peerId}
          connected={connectedPeerId === peer.peerId}
          {onConnect}
          {onDisconnect} />
      {/each}
    </div>
  {/if}
</section>

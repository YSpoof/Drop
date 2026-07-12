<script lang="ts">
  import DeviceCard from "$lib/components/device/DeviceCard.svelte";
  import type { PeerInfo } from "$lib/utils/signaling/types";
  import LinkIcon from "~icons/mdi/link";
  import LinkOffIcon from "~icons/mdi/link-off";
  import LockOpenOutlineIcon from "~icons/mdi/lock-open-outline";
  import LockOutlineIcon from "~icons/mdi/lock-outline";
  import RadioTowerIcon from "~icons/mdi/radio-tower";

  interface Props {
    peers: PeerInfo[];
    inRoom?: boolean;
    hasAutoKey?: boolean;
    connectingPeerId?: string | null;
    connectedPeerId?: string | null;
    connected?: boolean;
    onConnect: (peerId: string) => void;
    onDisconnect?: () => void;
    onRoomClick?: () => void;
    onAutoKeyClick?: () => void;
    onAutoConnect?: (peerId: string) => void;
  }

  let {
    peers,
    inRoom = false,
    hasAutoKey = false,
    connectingPeerId = null,
    connectedPeerId = null,
    connected = false,
    onConnect,
    onDisconnect,
    onRoomClick,
    onAutoKeyClick,
    onAutoConnect,
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
    {#if !connected}
      <div class="flex items-center gap-1">
        <button
          class="btn btn-ghost btn-circle tooltip tooltip-left"
          data-tip={hasAutoKey ? "Auto-conexão ativada" : "Auto-conexão desativada"}
          onclick={onAutoKeyClick}>
          {#if hasAutoKey}
            <LockOpenOutlineIcon class="text-warning text-lg" />
          {:else}
            <LockOutlineIcon class="text-primary text-lg" />
          {/if}
        </button>
        <button
          class="btn btn-ghost btn-circle tooltip tooltip-left"
          data-tip={inRoom ? "Sair da sala" : "Gerar link"}
          onclick={onRoomClick}>
          {#if inRoom}
            <LinkIcon class="text-success text-lg" />
          {:else}
            <LinkOffIcon class="text-primary text-lg" />
          {/if}
        </button>
      </div>
    {/if}
  </div>
  {#if !peers.length}
    <p class="text-base-content/60 skeleton skeleton-text text-sm">
      Procurando por dispositivos {inRoom ? "via link remoto" : " na sua rede local"}...
    </p>
  {:else}
    <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {#each peers as peer (peer.peerId)}
        <DeviceCard
          {peer}
          disabled={connecting}
          connecting={connectingPeerId === peer.peerId}
          connected={connectedPeerId === peer.peerId}
          {onConnect}
          {onDisconnect}
          {onAutoConnect} />
      {/each}
    </div>
  {/if}
</section>

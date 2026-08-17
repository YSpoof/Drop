import type { PeerInfo } from "#lib/utils/signaling/types.js";

class PeerStore {
  peers = $state<PeerInfo[]>([]);
  connectingPeerId = $state<string | null>(null);
  connectedPeerId = $state<string | null>(null);
  connectedPeerInfo = $state<PeerInfo | null>(null);
  localIps = $state<string[]>([]);
  pendingRequest = $state<PeerInfo | null>(null);
  
  roomJoinPhase = $state<"waiting" | "connecting" | "connected" | "failed">("waiting");
  roomJoinMode = $state<"auto" | "ask" | null>(null);
  roomJoinCode = $state<string | null>(null);
  roomJoinTargetPeerId = $state<string | null>(null);

  connected = $derived(this.connectedPeerId !== null);

  displayPeers = $derived.by(() => {
    if (!this.connectedPeerInfo) return this.peers;
    return [
      this.connectedPeerInfo,
      ...this.peers.filter((peer) => peer.peerId !== this.connectedPeerInfo!.peerId),
    ];
  });
}

export const peerStore = new PeerStore();

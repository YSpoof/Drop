import type { PeerInfo } from "#lib/utils/signaling/types.js";

class PeerStore {
  connectingPeerId = $state<string | null>(null);
  connectedPeerId = $state<string | null>(null);
  connectedPeerInfo = $state<PeerInfo | null>(null);
  connectedViaLan = $state(false);

  codeJoinPhase = $state<"waiting" | "connecting" | "connected">("waiting");

  connected = $derived(this.connectedPeerId !== null);
}

export const peerStore = new PeerStore();

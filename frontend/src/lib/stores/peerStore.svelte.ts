import type { PeerInfo } from "#lib/utils/signaling/types.js";

export type CodeJoinPhase = "waiting" | "connecting" | "connected";

class PeerStore {
  connectingPeerId = $state<string | null>(null);
  connectedPeerId = $state<string | null>(null);
  connectedPeerInfo = $state<PeerInfo | null>(null);
  connectedViaLan = $state(false);

  codeJoinPhase = $state<CodeJoinPhase>("waiting");

  connected = $derived(this.connectedPeerId !== null);
}

export const peerStore = new PeerStore();

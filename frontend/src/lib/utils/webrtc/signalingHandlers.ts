import { peerStore } from "#lib/stores/peerStore.svelte.js";
import { toastStore } from "#lib/stores/toast.svelte.js";
import { logger } from "#lib/utils/logger.js";
import type { ServerMessage } from "#lib/utils/signaling/types.js";
import type { CodeJoinController } from "#lib/utils/webrtc/codeJoin.js";
import type { PeerSessionCoordinator } from "#lib/utils/webrtc/peerSession.js";

export type SignalingHandlerDeps = {
  peerSession: PeerSessionCoordinator;
  codeJoin: CodeJoinController;
  joinSignaling: () => Promise<void>;
  onCodeAssigned: (code: string) => void;
};

export function createSignalingHandlers(deps: SignalingHandlerDeps) {
  let disconnectNotified = false;

  return {
    onOpen: () => {
      disconnectNotified = false;
      void deps.joinSignaling();
    },
    onCodeAssigned: (message: Extract<ServerMessage, { type: "code-assigned" }>) => {
      deps.onCodeAssigned(message.code);
    },
    onPeerJoining: (message: Extract<ServerMessage, { type: "peer-joining" }>) => {
      const requesterId = message.requester.peerId;
      logger.log(`(Share) peer-joining ← ${requesterId}`);

      // Only the current peer may re-pair (e.g. after a reload); another PIN holder must not
      // take over a pairing in progress or an open connection.
      const current = peerStore.connectedPeerId ?? peerStore.connectingPeerId;
      if (current && current !== requesterId) return;

      // `connectPeer` marks the requester as the connecting peer.
      peerStore.connectedPeerInfo = message.requester;
      deps.peerSession.connectPeer(requesterId, !!message.lan);
    },
    onJoinAccepted: (message: Extract<ServerMessage, { type: "join-accepted" }>) => {
      logger.log(`(Share) join-accepted ← ${message.host.peerId}`);
      peerStore.connectedPeerInfo = message.host;
      deps.codeJoin.onJoinAccepted(message.host.peerId, !!message.lan);
    },
    onJoinRejected: () => {
      deps.codeJoin.onJoinRejected();
    },
    onSignal: (message: Extract<ServerMessage, { type: "signal" }>) => {
      deps.peerSession.handleSignal(message.fromPeerId, message.payload);
    },
    onClose: () => {
      if (peerStore.connectedPeerId || disconnectNotified) return;
      disconnectNotified = true;
      toastStore.showToast("Desconectado do servidor de emparelhamento", "warning");
    },
  };
}

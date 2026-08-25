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

      if (peerStore.connectedPeerId || peerStore.connectingPeerId) return;

      peerStore.connectedPeerInfo = message.requester;
      deps.peerSession.setIceLan(!!message.lan);
      deps.peerSession.beginAsAnswerer(requesterId);
    },
    onJoinAccepted: (message: Extract<ServerMessage, { type: "join-accepted" }>) => {
      logger.log(`(Share) join-accepted ← ${message.host.peerId}`);
      peerStore.connectedPeerInfo = message.host;
      deps.codeJoin.onJoinAccepted(message.host.peerId, !!message.lan);
    },
    onJoinRejected: () => {
      deps.codeJoin.onJoinRejected();
    },
    onSdpOffer: async (message: Extract<ServerMessage, { type: "sdp-offer" }>) => {
      await deps.peerSession.handleSdpOffer(message.fromPeerId, message.sdp, message.iceMode);
    },
    onSdpAnswer: async (message: Extract<ServerMessage, { type: "sdp-answer" }>) => {
      await deps.peerSession.handleSdpAnswer(message.sdp);
    },
    onIceCandidate: async (message: Extract<ServerMessage, { type: "ice-candidate" }>) => {
      await deps.peerSession.handleIceCandidate(message.fromPeerId, message.candidate);
    },
    onClose: (intentional: boolean) => {
      if (intentional || peerStore.connectedPeerId || disconnectNotified) return;
      disconnectNotified = true;
      toastStore.showToast("Desconectado do servidor de emparelhamento", "warning");
    },
  };
}

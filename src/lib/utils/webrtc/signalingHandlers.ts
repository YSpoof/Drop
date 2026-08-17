import { appState } from "#lib/stores/appState.svelte.js";
import { toastStore } from "#lib/stores/toast.svelte.js";
import { logger } from "#lib/utils/logger.js";
import type { SignalingClient } from "#lib/utils/signaling/client.js";
import type { PeerInfo } from "#lib/utils/signaling/types.js";
import { handleConnectionRequest } from "#lib/utils/webrtc/connectionRequest.js";
import type { PeerSessionCoordinator } from "#lib/utils/webrtc/peerSession.js";
import type { RoomJoinController } from "#lib/utils/webrtc/roomJoin.js";

export type SignalingHandlerDeps = {
  signaling: SignalingClient;
  peerSession: PeerSessionCoordinator;
  roomJoin: RoomJoinController;
  findPeer: (peerId: string) => PeerInfo | undefined;
  getRoomCode: () => string | undefined;
  joinSignaling: () => Promise<void>;
  clearPendingRequest: () => void;
  getSignalingDisconnectNotified: () => boolean;
  setSignalingDisconnectNotified: (value: boolean) => void;
};

export function createSignalingHandlers(deps: SignalingHandlerDeps) {
  return {
    onOpen: () => {
      deps.setSignalingDisconnectNotified(false);
      void deps.joinSignaling();
    },
    onPeerList: (message: { peers: PeerInfo[] }) => {
      appState.peers = message.peers;

      if (
        appState.pendingRequest &&
        !message.peers.some((peer) => peer.peerId === appState.pendingRequest!.peerId)
      ) {
        const requesterName = appState.pendingRequest.displayName;
        deps.clearPendingRequest();
        toastStore.showToast(`${requesterName} desconectou`, "warning");
      }

      deps.roomJoin.onPeerListUpdated();
    },
    onConnectRequest: (message: { requester: PeerInfo; roomCode?: string }) => {
      handleConnectionRequest(message.requester, message.roomCode, {
        sendConnectResponse: (targetPeerId, accepted, reason) =>
          deps.peerSession.sendConnectResponse(targetPeerId, accepted, reason),
        beginAsAnswerer: (requesterPeerId) => deps.peerSession.beginAsAnswerer(requesterPeerId),
        handleMutualConnect: (requesterPeerId) =>
          deps.peerSession.handleMutualConnect(requesterPeerId),
        findPeer: (peerId) => deps.findPeer(peerId),
        getHostRoomCode: () => deps.getRoomCode(),
      });
    },
    onConnectResponse: async (message: { accepted: boolean; targetPeerId: string }) => {
      logger.log(
        `(Room) connect-response ← ${message.targetPeerId} ${message.accepted ? "accepted" : "rejected"}`,
      );
      if (!message.accepted) {
        if (appState.connectingPeerId === message.targetPeerId) {
          deps.roomJoin.onConnectResponseRejected(message.targetPeerId);
        }
        return;
      }

      if (appState.connectingPeerId !== message.targetPeerId) return;
      if (deps.peerSession.shouldSkipConnectResponse(message.targetPeerId)) return;

      await deps.peerSession.beginAsOfferer(message.targetPeerId);
    },
    onSdpOffer: async (message: { fromPeerId: string; sdp: RTCSessionDescriptionInit }) => {
      await deps.peerSession.handleSdpOffer(message.fromPeerId, message.sdp);
    },
    onSdpAnswer: async (message: { sdp: RTCSessionDescriptionInit }) => {
      await deps.peerSession.handleSdpAnswer(message.sdp);
    },
    onIceCandidate: async (message: { fromPeerId: string; candidate: RTCIceCandidateInit }) => {
      await deps.peerSession.handleIceCandidate(message.fromPeerId, message.candidate);
    },
    onClose: (intentional: boolean) => {
      if (intentional || appState.connectedPeerId) return;
      if (!deps.getSignalingDisconnectNotified()) {
        deps.setSignalingDisconnectNotified(true);
        toastStore.showToast("Desconectado do servidor de emparelhamento", "warning");
      }
    },
  };
}

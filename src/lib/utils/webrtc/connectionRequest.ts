import { appState } from "$lib/stores/appState.svelte";
import { logger } from "$lib/utils/logger";
import type { PeerInfo } from "$lib/utils/signaling/types";

export type ConnectionRequestActions = {
  sendConnectResponse: (targetPeerId: string, accepted: boolean, reason?: string) => void;
  beginAsAnswerer: (requesterPeerId: string) => void;
  handleMutualConnect: (requesterPeerId: string) => void;
  findPeer: (peerId: string) => PeerInfo | undefined;
  getHostRoomCode: () => string | undefined;
};

/**
 * Manages the user consent dialog flow when a remote peer wants to connect.
 */
export function handleConnectionRequest(
  requester: PeerInfo,
  roomCode: string | undefined,
  actions: ConnectionRequestActions,
): void {
  const requesterId = requester.peerId;
  const hostRoomCode = actions.getHostRoomCode();
  logger.log(`(Room) connect-request ← ${requesterId}${roomCode ? ` roomCode=${roomCode}` : ""}`);

  if (roomCode) {
    if (hostRoomCode && roomCode === hostRoomCode) {
      if (appState.connectedPeerId || appState.connectingPeerId || appState.pendingRequest) {
        actions.sendConnectResponse(requesterId, false, "busy");
        return;
      }

      const peerInfo = actions.findPeer(requesterId) ?? requester;
      appState.connectedPeerInfo = peerInfo;

      actions.sendConnectResponse(requesterId, true);
      actions.beginAsAnswerer(requesterId);
      return;
    }

    actions.sendConnectResponse(requesterId, false, "wrong-code");
    return;
  }

  if (appState.connectedPeerId) {
    actions.sendConnectResponse(requesterId, false, "busy");
    return;
  }

  if (appState.connectingPeerId === requesterId) {
    actions.handleMutualConnect(requesterId);
    return;
  }

  if (appState.connectingPeerId || appState.pendingRequest) {
    actions.sendConnectResponse(requesterId, false, "busy");
    return;
  }

  logger.log(`(Room) connect-request pending modal for ${requesterId}`);
  appState.pendingRequest = requester;
  appState.connectionModalOpen = true;
}

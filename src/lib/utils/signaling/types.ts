export interface PeerInfo {
  peerId: string;
  displayName: string;
  deviceHint: string;
  room?: string;
  nearby: boolean;
}

export interface PeerListMessage {
  type: "peer-list";
  peers: PeerInfo[];
}

export type ClientMessage =
  | {
      type: "announce";
      peerId: string;
      displayName: string;
      deviceHint: string;
      room?: string;
      localIps: string[];
    }
  | { type: "connect-request"; targetPeerId: string; roomCode?: string }
  | { type: "connect-response"; targetPeerId: string; accepted: boolean }
  | {
      type: "sdp-offer";
      targetPeerId: string;
      sdp: RTCSessionDescriptionInit;
    }
  | {
      type: "sdp-answer";
      targetPeerId: string;
      sdp: RTCSessionDescriptionInit;
    }
  | {
      type: "ice-candidate";
      targetPeerId: string;
      candidate: RTCIceCandidateInit;
    }
  | { type: "ping" };

export type ServerMessage =
  | PeerListMessage
  | { type: "connect-request"; requester: PeerInfo; roomCode?: string }
  | {
      type: "connect-response";
      accepted: boolean;
      targetPeerId: string;
    }
  | {
      type: "sdp-offer";
      fromPeerId: string;
      sdp: RTCSessionDescriptionInit;
    }
  | {
      type: "sdp-answer";
      fromPeerId: string;
      sdp: RTCSessionDescriptionInit;
    }
  | {
      type: "ice-candidate";
      fromPeerId: string;
      candidate: RTCIceCandidateInit;
    }
  | { type: "pong" };

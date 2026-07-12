export interface PeerInfo {
  peerId: string;
  displayName: string;
  deviceHint: string;
  room?: string;
  nearby: boolean;
  hasAutoKey?: boolean;
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
      hasAutoKey?: boolean;
    }
  | { type: "connect-request"; targetPeerId: string; autoKey?: string }
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
    };

export type ServerMessage =
  | PeerListMessage
  | { type: "connect-request"; requester: PeerInfo; autoKey?: string }
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
    };

export type IceMode = "local" | "all";

export interface PeerInfo {
  peerId: string;
  displayName: string;
  deviceHint: string;
}

export type ClientMessage =
  | {
      type: "announce";
      peerId: string;
      displayName: string;
      deviceHint: string;
      host?: boolean;
      code?: string;
      publicIpv4?: string;
    }
  | { type: "join-code"; code: string }
  | {
      type: "sdp-offer";
      targetPeerId: string;
      sdp: RTCSessionDescriptionInit;
      iceMode?: IceMode;
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
  | { type: "code-assigned"; code: string }
  | { type: "peer-joining"; requester: PeerInfo; lan?: boolean }
  | { type: "join-accepted"; host: PeerInfo; lan?: boolean }
  | { type: "join-rejected" }
  | {
      type: "sdp-offer";
      fromPeerId: string;
      sdp: RTCSessionDescriptionInit;
      iceMode?: IceMode;
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

import type { SignalPayload } from "fastrtc";

export interface PeerInfo {
  peerId: string;
  displayName: string;
}

export type ClientMessage =
  | {
      type: "announce";
      peerId: string;
      displayName: string;
      host?: boolean;
      code?: string;
      publicIpv4?: string;
    }
  | { type: "join-code"; code: string }
  | {
      type: "signal";
      targetPeerId: string;
      payload: SignalPayload;
    }
  | { type: "ping" };

export type ServerMessage =
  | { type: "code-assigned"; code: string }
  | { type: "peer-joining"; requester: PeerInfo; lan?: boolean }
  | { type: "join-accepted"; host: PeerInfo; lan?: boolean }
  | { type: "join-rejected" }
  | {
      type: "signal";
      fromPeerId: string;
      payload: SignalPayload;
    }
  | { type: "pong" };

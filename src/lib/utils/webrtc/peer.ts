import { ICE_SERVERS } from "./ice";

export const CONTROL_CHANNEL_ID = 0;
export const FILES_CHANNEL_ID = 1;

export type IceCandidateHandler = (candidate: RTCIceCandidate) => void;
export type ConnectionStateHandler = (state: RTCPeerConnectionState) => void;

export class PeerConnection {
  readonly pc: RTCPeerConnection;
  readonly controlChannel: RTCDataChannel;
  readonly filesChannel: RTCDataChannel;
  onIceCandidate: IceCandidateHandler | null = null;
  onConnectionStateChange: ConnectionStateHandler | null = null;

  constructor() {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidate) {
        this.onIceCandidate(event.candidate);
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.onConnectionStateChange?.(this.pc.connectionState);
    };

    this.controlChannel = this.pc.createDataChannel("ctrl", {
      negotiated: true,

      id: CONTROL_CHANNEL_ID,
      ordered: true,
    });
    this.filesChannel = this.pc.createDataChannel("files", {
      negotiated: true,
      id: FILES_CHANNEL_ID,
      ordered: true,
    });
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(sdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(sdp);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(sdp);
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!candidate.candidate) return;
    await this.pc.addIceCandidate(candidate);
  }

  close() {
    this.controlChannel.close();
    this.filesChannel.close();
    this.pc.close();
  }
}

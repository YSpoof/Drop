import { ICE_SERVERS } from "./ice";

export type IceCandidateHandler = (candidate: RTCIceCandidate) => void;
export type DataChannelHandler = (channel: RTCDataChannel) => void;
export type ConnectionStateHandler = (state: RTCPeerConnectionState) => void;

export class PeerConnection {
  readonly pc: RTCPeerConnection;
  channel: RTCDataChannel | null = null;
  onIceCandidate: IceCandidateHandler | null = null;
  onDataChannel: DataChannelHandler | null = null;
  onConnectionStateChange: ConnectionStateHandler | null = null;

  constructor(private readonly isOfferer: boolean) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidate) {
        this.onIceCandidate(event.candidate);
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.onConnectionStateChange?.(this.pc.connectionState);
    };

    this.pc.ondatachannel = (event) => {
      this.channel = event.channel;
      this.onDataChannel?.(event.channel);
    };
  }

  /** Call after `onDataChannel` is assigned — offerer channel is created here, not in the constructor. */
  prepareChannel() {
    if (!this.isOfferer || this.channel) return;
    this.channel = this.pc.createDataChannel("drop", {
      ordered: true,
    });
    this.onDataChannel?.(this.channel);
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
    this.channel?.close();
    this.pc.close();
  }
}

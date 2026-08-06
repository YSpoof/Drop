import { isPrivateIp } from "$lib/utils/net/privateIp";

import { ICE_SERVERS } from "./peer";

function extractIpv4(candidate: string): string | null {
  const match = candidate.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
  return match?.[1] ?? null;
}

export async function discoverLocalIps(): Promise<string[]> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const ips = new Set<string>();

  pc.createDataChannel("discovery");

  const { promise, resolve } = Promise.withResolvers<string[]>();
  const timeout = setTimeout(() => resolve([...ips]), 2000);

  pc.onicecandidate = (event) => {
    if (!event.candidate) {
      clearTimeout(timeout);
      resolve([...ips]);
      return;
    }

    if (event.candidate.type !== "host") return;
    const ip = extractIpv4(event.candidate.candidate);
    if (ip && isPrivateIp(ip)) ips.add(ip);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const result = await promise;
  pc.close();
  return result;
}

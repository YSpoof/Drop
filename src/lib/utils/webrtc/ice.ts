import { isPrivateIp } from "#lib/utils/net/privateIp.js";
import type { IceMode } from "#lib/utils/signaling/types.js";

function candidateString(candidate: RTCIceCandidate | RTCIceCandidateInit): string {
  return candidate.candidate ?? "";
}

function candidateType(candidate: RTCIceCandidate | RTCIceCandidateInit): string | undefined {
  if ("type" in candidate && candidate.type) return candidate.type;
  const match = candidateString(candidate).match(/\btyp\s+(\w+)/);
  return match?.[1];
}

function candidateAddress(candidate: RTCIceCandidate | RTCIceCandidateInit): string | undefined {
  if ("address" in candidate && candidate.address) return candidate.address;
  const str = candidateString(candidate).replace(/^candidate:/, "");
  const parts = str.split(" ");
  return parts[4];
}

export function isAllowedLocalCandidate(candidate: RTCIceCandidate | RTCIceCandidateInit): boolean {
  const type = candidateType(candidate);
  if (type && type !== "host") return false;

  const address = candidateAddress(candidate);
  if (!address) return false;
  if (address.endsWith(".local")) return true;
  return isPrivateIp(address);
}

export function shouldSendOrAcceptCandidate(
  iceMode: IceMode,
  candidate: RTCIceCandidate | RTCIceCandidateInit,
): boolean {
  if (iceMode === "all") return true;
  return isAllowedLocalCandidate(candidate);
}

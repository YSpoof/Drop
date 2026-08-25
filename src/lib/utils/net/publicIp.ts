import { isPublicIpv4 } from "./privateIp";

const IPIFY_URL = "https://api.ipify.org";
const IPIFY_TIMEOUT_MS = 3_000;

export async function fetchPublicIpv4(): Promise<string | undefined> {
  try {
    const res = await fetch(IPIFY_URL, { signal: AbortSignal.timeout(IPIFY_TIMEOUT_MS) });
    if (!res.ok) return undefined;
    const ip = (await res.text()).trim();
    return isPublicIpv4(ip) ? ip : undefined;
  } catch {
    return undefined;
  }
}

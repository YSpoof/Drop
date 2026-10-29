import desfetch from "desfetch";

import { isPublicIpv4 } from "./privateIp";

const IPIFY_URL = "https://api.ipify.org";
const IPIFY_TIMEOUT_MS = 3_000;

export async function fetchPublicIpv4(): Promise<string | undefined> {
  try {
    const { data, error } = await desfetch(IPIFY_URL, {
      signal: AbortSignal.timeout(IPIFY_TIMEOUT_MS),
      parse: (r) => r.text(),
    });
    if (error) return undefined;
    return isPublicIpv4(data.trim()) ? data.trim() : undefined;
  } catch {
    return undefined;
  }
}

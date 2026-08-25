/** RFC1918 private IPv4 check (first two octets). */
export function isPrivateOctet(a: number, b: number): boolean {
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
}

export function isPrivateIp(ip: string): boolean {
  const parts = parseIpv4(ip);
  if (!parts) return false;
  return isPrivateOctet(parts[0], parts[1]);
}

export function isPublicIpv4(ip: string): boolean {
  const parts = parseIpv4(ip);
  if (!parts) return false;
  const [a, b] = parts;
  if (a === 0 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  return !isPrivateOctet(a, b);
}

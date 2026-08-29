type NavigatorUAData = { platform: string };

const MOBILE_OR_CROS = /Android|iPhone|iPad|iPod|CrOS/;

function uaDataPlatform(): string | undefined {
  const data = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  return data?.platform;
}

export function isWindowsOrLinux(): boolean {
  const platform = uaDataPlatform();
  if (platform) return platform === "Windows" || platform === "Linux";

  const ua = navigator.userAgent;
  if (MOBILE_OR_CROS.test(ua)) return false;
  return ua.includes("Windows") || ua.includes("Linux");
}

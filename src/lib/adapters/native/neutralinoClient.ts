import { init, os, resources, computer, filesystem, extensions } from "@neutralinojs/lib";

import { connectStreamer } from "#lib/adapters/native/streamerClient.js";

/** Opens the framework WebSocket, extracts the streamer, and waits until it is ready (or rejects). */
export async function startNeutralino(): Promise<void> {
  init();

  // Extract extension binaries from resources and wait for streamer connection
  await Promise.all([extractExtensionBinaries(), connectStreamer(2000)]);
}

/**
 * Extracts the platform-appropriate extension binary from resources to a writable directory.
 * Launches the binary with Neutralino bootstrap credentials piped to stdin.
 */
async function extractExtensionBinaries(): Promise<void> {
  try {
    const stats = await extensions.getStats().catch(() => null);
    if (stats?.connected?.includes("br.com.lzart.drop.streamer")) {
      return;
    }
  } catch {
    // Ignore stats check failure, proceed with launch
  }

  const osInfo = await computer.getOSInfo();
  const tmpDir = await os.getPath("temp");

  // Determine the binary filename based on OS
  let binaryName: string;
  if (osInfo.name.includes("Windows")) {
    binaryName = "streamer-win_x64.exe";
  } else {
    // Default to Linux (includes Linux, macOS, and other Unix-like systems)
    binaryName = "streamer-linux_x64";
  }

  const sourcePath = `/native/extensions/compiled/${binaryName}`;
  const destPath = `${tmpDir}/${binaryName}`;

  try {
    // Clean the destpath
    await filesystem.remove(destPath).catch(() => {});

    // Extract the binary from resources
    await resources.extractFile(sourcePath, destPath);

    // Make the binary executable (chmod +x)
    await filesystem.chmod(destPath, 0o755).catch(() => {});

    // Log the extraction
    console.log(`Extension binary extracted to ${destPath}`);

    const token = window.NL_TOKEN || sessionStorage.getItem("NL_TOKEN") || "";
    const connectToken = token.includes(".") ? token.split(".")[1] : "";
    const port = window.NL_PORT;
    const extensionId = "br.com.lzart.drop.streamer";

    const bootstrap = JSON.stringify({
      nlPort: port,
      nlToken: token,
      nlConnectToken: connectToken,
      nlExtensionId: extensionId,
    });

    // Run the binary with bootstrap credentials on stdin
    console.log(`Executing extension binary at ${destPath}`);

    await os.execCommand(destPath, {
      background: true,
      stdIn: bootstrap,
    });
  } catch (error) {
    console.error(`Failed to extract extension binary:`, error);
  }
}

# Proposal

## Why
Currently, the Drop application packages extension binaries (specifically the streamer extension) in the `/extensions/compiled/` directory and references them directly in `neutralino.config.json` using `commandLinux` and `commandWindows` with `${NL_PATH}` paths. This approach requires separate extension binaries alongside the executable and prevents bundling them inside application resources for single-binary distribution. By keeping only the extension ID in `neutralino.config.json` (removing `commandLinux` and `commandWindows`), the application can extract the extension binary at runtime from resources and execute it explicitly.

## What Changes
- Remove `commandLinux` and `commandWindows` attributes from the extension entry in `neutralino.config.json`, keeping only the extension `id` (`br.com.lzart.drop.streamer`)
- Bundle extension binaries in the `/resources/extensions/` directory instead of `/extensions/compiled/`
- Update the build process to copy extension binaries into the resources directory during packaging
- At application startup, extract the platform-appropriate extension binary from resources to a writable directory using `Neutralino.resources.extractFile()`
- Make the extracted binary executable (e.g. `chmod` on Unix/Linux) and launch/spawn the extension process at runtime
- Ensure `nativeAllowList` in `neutralino.config.json` allows necessary APIs (`resources.*`, `os.spawnProcess`, `os.execCommand`, `filesystem.chmod`, etc.)
- Connect to and interact with the streamer as before once spawned

## Capabilities
### Modified Capabilities
- `native-file-streamer`: Extension is no longer automatically spawned by the Neutralino framework via config command attributes; instead, the application extracts the binary from resources and spawns it at runtime.

## Impact
- `neutralino.config.json`: Extension entry has only `id` property; `nativeAllowList` includes `resources.*` and process execution APIs
- Build scripts (`scripts/build-streamer.sh`, `package.json`): Build and copy binaries into resources directory
- `src/lib/adapters/native/neutralinoClient.ts`: Coordinate extraction and execution of extension binary during native startup
- `src/lib/adapters/native/streamerClient.ts`: Works with runtime-extracted and spawned streamer binary
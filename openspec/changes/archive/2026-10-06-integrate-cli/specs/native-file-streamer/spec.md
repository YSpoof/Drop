# Spec Delta

## MODIFIED Requirements

### Requirement: Packaged shells include an x64 streamer

A packaged native shell for linux x64 and windows x64 SHALL include a streamer executable for that OS embedded within the application resources. The streamer source and its compiled binaries SHALL live under `native/extensions/` in this repository. The production/CI native package build SHALL compile those binaries for linux x64 and windows x64 before packaging. The native shell SHALL extract the streamer executable from the Neutralino resources path that embeds those compiled binaries to a writable temporary location at runtime and launch that executable. The streamer extension will no longer be launched automatically by Neutralino via configuration commands.

#### Scenario: Each package can launch its sidecar

- **WHEN** a linux x64 or windows x64 package starts
- **THEN** that package launches the streamer executable built for the same OS and x64

#### Scenario: Extension is extracted from resources at startup

- **WHEN** the native shell starts
- **THEN** the shell extracts the platform-appropriate streamer binary from the configured Neutralino resources path for compiled streamers under the `native/extensions` tree to a writable temporary directory
- **AND** the shell makes the binary executable and launches the streamer process using Neutralino.os.spawnProcess()
- **AND** the shell provides the streamer with the necessary Neutralino bootstrap data via stdin (port, token, connectToken, extensionID)
- **AND** the streamer executable runs and communicates with the shell as specified, broadcasting `streamerReady` events

#### Scenario: Extension cleanup on shell exit

- **WHEN** the native shell closes its framework connection
- **THEN** the spawned streamer process exits
- **AND** any temporary extracted extension files may be cleaned up

#### Scenario: CI compiles streamer from native/extensions

- **WHEN** the production Docker/CI native package stage runs
- **THEN** it builds `streamer-linux_x64` and `streamer-win_x64.exe` from `native/extensions/streamer` (or equivalent module path under `native/extensions`) before embedding them in the package

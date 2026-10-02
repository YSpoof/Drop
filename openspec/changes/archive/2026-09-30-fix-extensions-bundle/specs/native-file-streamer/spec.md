# Spec Delta

## Purpose
Modify how the native-file-streamer extension is packaged and launched to allow bundling extension binaries within application resources, enabling single-binary distribution and improved deployment flexibility. This change removes Neutralino's automatic extension launching mechanism in favor of manual extraction and execution at runtime.

## MODIFIED Requirements

### Requirement: Packaged shells include an x64 streamer
A packaged native shell for linux x64 and windows x64 SHALL include a streamer executable for that OS embedded within the application resources. The native shell SHALL extract the streamer executable from resources to a writable temporary location at runtime and launch that executable. The streamer extension will no longer be launched automatically by Neutralino via configuration commands.

#### Scenario: Extension is extracted from resources at startup
- **WHEN** the native shell starts
- **THEN** the shell extracts the platform-appropriate streamer binary from `/resources/extensions/` to a writable temporary directory
- **AND** the shell makes the binary executable and launches the streamer process using Neutralino.os.spawnProcess()
- **AND** the shell provides the streamer with the necessary Neutralino bootstrap data via stdin (port, token, connectToken, extensionID)
- **AND** the streamer executable runs and communicates with the shell as specified, broadcasting `streamerReady` events

#### Scenario: Extension cleanup on shell exit
- **WHEN** the native shell closes its framework connection
- **THEN** the spawned streamer process exits
- **AND** any temporary extracted extension files may be cleaned up
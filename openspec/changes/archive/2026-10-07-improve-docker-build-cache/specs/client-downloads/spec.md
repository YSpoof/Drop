# Spec Delta

## MODIFIED Requirements

### Requirement: CI publishes Go and desktop clients
A production image/build that ships the web app SHALL include linux/windows x64 streamer extension binaries used by the native package, linux/windows x64 CLI binaries at the published `/downloads/` CLI filenames, and linux/windows x64 desktop app binaries at the published desktop filenames. Those artifacts MUST be produced by the Docker/CI pipeline from source (not checked-in prebuilt download binaries). Streamer binaries MUST be compiled from `native/extensions` before they are embedded in the desktop package whenever streamer or native packaging inputs change. When only web application sources change, the pipeline MAY reuse a Docker-cached desktop package and still MUST publish the same `/downloads/` desktop filenames from that cached output.

#### Scenario: Production build includes CLI downloads
- **WHEN** the production Docker/CI build completes
- **THEN** `/downloads/Drop-cli-linux_x64` and `/downloads/Drop-cli-win_x64.exe` are present in the served static downloads

#### Scenario: Production build rebuilds streamer
- **WHEN** the production Docker/CI native package stage runs
- **THEN** it compiles the streamer for linux x64 and windows x64 from `native/extensions` before packaging the desktop app

#### Scenario: Web-only rebuild still publishes desktop downloads
- **WHEN** the production Docker/CI build completes after only web application source changes and the desktop package stage hits cache
- **THEN** `/downloads/Drop-linux_x64` and `/downloads/Drop-win_x64.exe` are still present in the served static downloads

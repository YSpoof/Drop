# Spec Delta

## ADDED Requirements

### Requirement: CI publishes CLI and desktop clients
A production build that ships the web app SHALL include linux/windows x64 CLI and desktop binaries at the published `/downloads/` filenames. Those artifacts MUST be built from source by the Docker/CI pipeline, not checked in. When only web application sources change, the pipeline MAY reuse Docker-cached client binaries and MUST still publish the same filenames.

#### Scenario: Production build includes CLI downloads
- **WHEN** the production Docker/CI build completes
- **THEN** `/downloads/Drop-cli-linux_x64` and `/downloads/Drop-cli-win_x64.exe` are present in the served static downloads

#### Scenario: Production build includes desktop downloads
- **WHEN** the production Docker/CI build completes
- **THEN** `/downloads/Drop-linux_x64` and `/downloads/Drop-win_x64.exe` are present in the served static downloads

#### Scenario: Web-only rebuild still publishes client downloads
- **WHEN** the production Docker/CI build completes after only web application source changes and the client build stage hits cache
- **THEN** all four `/downloads/` client filenames are still present in the served static downloads

## REMOVED Requirements

### Requirement: CI publishes Go and desktop clients

**Reason**: It requires sidecar streamer binaries built from `native/extensions`, which no longer exist; the streamer runs inside the desktop host.

**Migration**: See the CI publishes CLI and desktop clients requirement; the four published `/downloads/` filenames are unchanged.

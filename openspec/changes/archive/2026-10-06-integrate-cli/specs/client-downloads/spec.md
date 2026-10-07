# Spec Delta

## Purpose

Lets web users choose a Drop client product and download the matching Windows or Linux binary from the install modal.

## ADDED Requirements

### Requirement: Product choice before OS downloads
The install modal on Windows and Linux desktop browsers SHALL let the user choose between **CLI** and **Aplicativo** before showing platform download links. Selecting a product SHALL reveal that product’s Windows and Linux download actions. macOS browsers SHALL NOT be offered native desktop or CLI binaries in this modal; they MAY still use the buried PWA install path when a browser install prompt is available.

#### Scenario: User opens install modal on desktop OS
- **WHEN** a Windows or Linux browser user opens the install modal
- **THEN** the modal presents CLI and Aplicativo as the primary choices
- **AND** does not show both products’ OS download links at once before a product is selected

#### Scenario: Selecting CLI shows OS links
- **WHEN** the user selects CLI
- **THEN** the modal shows Windows and Linux download actions for the CLI
- **AND** does not show Aplicativo OS download actions in that view

#### Scenario: Selecting Aplicativo shows OS links
- **WHEN** the user selects Aplicativo
- **THEN** the modal shows Windows and Linux download actions for the desktop app
- **AND** exposes the PWA install option as a secondary/buried action under Aplicativo
- **AND** does not show CLI OS download actions in that view

#### Scenario: macOS has no native binary downloads
- **WHEN** a macOS browser user uses install entry points
- **THEN** the UI does not offer Drop CLI or Drop desktop native binary downloads
- **AND** if a PWA install prompt exists, the user may still install via PWA

### Requirement: Published download artifact URLs
The web app SHALL serve downloadable client binaries under `/downloads/` with stable filenames:

- Desktop: `Drop-win_x64.exe`, `Drop-linux_x64`
- CLI: `Drop-cli-win_x64.exe`, `Drop-cli-linux_x64`

The install modal download actions SHALL use those paths (or equivalent `siteData` entries pointing at them).

#### Scenario: Desktop Windows link
- **WHEN** the user chooses Aplicativo then Windows
- **THEN** the download targets `/downloads/Drop-win_x64.exe`

#### Scenario: Desktop Linux link
- **WHEN** the user chooses Aplicativo then Linux
- **THEN** the download targets `/downloads/Drop-linux_x64`

#### Scenario: CLI Windows link
- **WHEN** the user chooses CLI then Windows
- **THEN** the download targets `/downloads/Drop-cli-win_x64.exe`

#### Scenario: CLI Linux link
- **WHEN** the user chooses CLI then Linux
- **THEN** the download targets `/downloads/Drop-cli-linux_x64`

### Requirement: CI publishes Go and desktop clients
A production image/build that ships the web app SHALL include freshly built linux/windows x64 streamer extension binaries used by the native package, freshly built linux/windows x64 CLI binaries at the published `/downloads/` CLI filenames, and the existing linux/windows x64 desktop app binaries at the published desktop filenames.

#### Scenario: Production build includes CLI downloads
- **WHEN** the production Docker/CI build completes
- **THEN** `/downloads/Drop-cli-linux_x64` and `/downloads/Drop-cli-win_x64.exe` are present in the served static downloads

#### Scenario: Production build rebuilds streamer
- **WHEN** the production Docker/CI native package stage runs
- **THEN** it compiles the streamer for linux x64 and windows x64 from `native/extensions` before packaging the desktop app

# desktop-builds Specification

## Purpose

Defines how Drop's backend, CLI, and desktop applications share one workspace while remaining independently buildable and keeping application-specific code isolated.

## Requirements

### Requirement: Applications build independently from one workspace

The workspace SHALL build the backend, the CLI, and the desktop host as separate binaries on demand. Each application SHALL be buildable without building the others, and each SHALL be able to use shared workspace packages without depending on another application's private code.

#### Scenario: CLI builds independently

- **WHEN** a developer builds the CLI target
- **THEN** the CLI binary is produced without building the desktop or backend targets

#### Scenario: Desktop builds independently

- **WHEN** a developer builds the desktop target
- **THEN** the desktop binary is produced without building the CLI or backend targets

#### Scenario: Backend builds independently

- **WHEN** a developer builds the backend target
- **THEN** the backend binary is produced without building the CLI or desktop targets

#### Scenario: Shared package use preserves application isolation

- **WHEN** two applications use a package shared by the workspace
- **THEN** each application depends on the shared package and neither depends on the other application's private code

#### Scenario: All builds resolve the same dependency versions

- **WHEN** local or automated builds compile any of the applications
- **THEN** dependency versions come from the single lock file of the workspace

### Requirement: Each application ships as one file

Each built application SHALL be a single self-contained executable. The backend SHALL carry the web app build and the client downloads inside its executable. Running an application MUST NOT require other files from the build to be present next to it.

#### Scenario: Backend runs alone

- **WHEN** the backend executable is the only file in its container image
- **THEN** it serves the web app and the client downloads

#### Scenario: Clients run alone

- **WHEN** a user downloads only the CLI or desktop executable for their platform and runs it
- **THEN** it starts without needing companion files from the build

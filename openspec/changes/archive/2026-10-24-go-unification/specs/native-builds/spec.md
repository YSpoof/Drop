# Spec Delta

## Purpose

Defines how Drop's native CLI and desktop applications share one Go module while remaining independently buildable and retaining isolated application-specific packages.

## ADDED Requirements

### Requirement: Native applications build independently from one module

The native Go module SHALL declare one Go version and SHALL build the CLI and desktop as separate binaries on demand. Each application SHALL be buildable without building the other, and both SHALL be able to import shared native packages without depending on the other application's private packages.

#### Scenario: CLI builds independently

- **WHEN** a developer builds the CLI target
- **THEN** the CLI binary is produced without building the desktop target

#### Scenario: Desktop builds independently

- **WHEN** a developer builds the desktop target
- **THEN** the desktop binary is produced without building the CLI target

#### Scenario: Shared package use preserves application isolation

- **WHEN** both applications use a package shared by the native module
- **THEN** each application imports the shared package and neither imports the other application's private packages

#### Scenario: Both builds use the declared Go version

- **WHEN** local or automated builds compile either native application
- **THEN** the Go toolchain satisfies the single version declared by the native module

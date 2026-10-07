# Spec Delta

## ADDED Requirements

### Requirement: Supported operating systems
The Drop CLI module (`dropcli`) SHALL target only Linux and Windows. Building or compiling the module for any other `GOOS` (including Darwin/macOS) MUST fail. DIY packages under `dropcli/libs/` MUST NOT ship stub implementations whose sole purpose is returning an “unsupported platform” error for non-target operating systems.

#### Scenario: Linux and Windows compile
- **WHEN** building the CLI for `GOOS=linux` or `GOOS=windows`
- **THEN** the build succeeds for the packages required by the `dropcli` binary

#### Scenario: Other GOOS rejected
- **WHEN** building the CLI for a non-target `GOOS` such as `darwin`
- **THEN** the build fails due to missing platform implementations or explicit build constraints
- **AND** there is no DIY stub that compiles solely to return an unsupported-platform error

## MODIFIED Requirements

### Requirement: DIY package naming
In-house libraries used by the CLI SHALL live under import paths of the form `dropcli/libs/<short-name>`. Those packages MUST NOT be registered or `replace`d under another project's published module path (for example they MUST NOT pretend to be `github.com/...` upstream modules). The CLI SHALL use these DIY package directories: `clip` (clipboard write) and `breakread` (cancelable file read). It MUST NOT keep `libs/pty`, `libs/ptypair`, or `libs/cancelread`.

#### Scenario: Local import paths only
- **WHEN** application code imports a DIY helper (clipboard write or cancelable read)
- **THEN** the import path starts with `dropcli/libs/`
- **AND** `go.mod` has no `replace` that maps an upstream module path onto that helper

#### Scenario: Renamed helpers
- **WHEN** code needs a cancelable file reader
- **THEN** it imports `dropcli/libs/breakread`
- **AND** it does not import `dropcli/libs/pty`, `dropcli/libs/ptypair`, or `dropcli/libs/cancelread`
- **AND** the `libs/ptypair` package directory is absent

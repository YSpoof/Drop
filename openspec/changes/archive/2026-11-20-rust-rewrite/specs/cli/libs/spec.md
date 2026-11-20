# Spec Delta

## MODIFIED Requirements

### Requirement: In-house clipboard write
The CLI SHALL write text to the system clipboard through an in-house helper (exposed to UI code as a single write-text entry point). The helper SHALL support Linux and Windows (the Drop CLI target platforms). On success, subsequent paste from the system clipboard yields that text. On failure, the helper SHALL return an error so existing PIN, share-link, and PIX copy UI can show failure feedback without crashing.

#### Scenario: Successful write
- **WHEN** the UI requests copying a non-empty string and the platform clipboard accepts it
- **THEN** the helper returns no error
- **AND** the system clipboard contains that string

#### Scenario: Windows write path exists
- **WHEN** building or running the CLI for Windows
- **THEN** clipboard write is implemented for that OS (not an unsupported stub)
- **AND** a successful write leaves the text on the system clipboard

#### Scenario: Failed write
- **WHEN** the UI requests copying and no working clipboard backend is available
- **THEN** the helper returns an error
- **AND** the process remains running so the caller can show failure feedback

## ADDED Requirements

### Requirement: Supported target platforms
The Drop CLI binary SHALL target only Linux and Windows. Building the CLI for any other operating system (including macOS) MUST fail. The CLI MUST NOT ship stub implementations whose sole purpose is returning an "unsupported platform" error for non-target operating systems.

#### Scenario: Linux and Windows compile
- **WHEN** building the CLI for Linux or Windows
- **THEN** the build succeeds

#### Scenario: Other operating systems rejected
- **WHEN** building the CLI for a non-target operating system such as macOS
- **THEN** the build fails due to missing platform implementations or an explicit compile-time guard
- **AND** there is no stub that compiles solely to return an unsupported-platform error

## REMOVED Requirements

### Requirement: Allowed third-party direct dependencies

**Reason**: The rule lists Go modules of a module layout that no longer exists. The Rust rewrite replaces the whole stack and keeps no dependency allow-list.

**Migration**: None. Dependencies are declared once in the workspace manifest. The ban on a third-party clipboard library survives as the in-house clipboard write requirement.

### Requirement: DIY package naming

**Reason**: The rule governs Go import paths. The cancelable-read helper is gone because one event loop now owns the terminal, and the clipboard helper is an ordinary module of the CLI.

**Migration**: None. Clipboard behavior stays specified by the in-house clipboard write requirement.

### Requirement: Supported operating systems

**Reason**: Restated without Go build terms (`GOOS`, build constraints, Go package paths).

**Migration**: See the supported target platforms requirement; the CLI still targets only Linux and Windows.

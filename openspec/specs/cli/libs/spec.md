# CLI Libs Specification

## Purpose

Defines which Drop CLI dependencies stay third-party versus in-house, how DIY packages are named under the module, and that system clipboard writes use the in-house clip helper.

## Requirements

### Requirement: Allowed third-party direct dependencies
The Drop CLI module (`dropcli`) SHALL keep only these third-party packages as direct `require` entries beyond the Go standard library and `golang.org/x/sys` / `golang.org/x/term`: Charmbracelet TUI (`bubbletea`, `huh`, `lipgloss`), Pion WebRTC (`pion/webrtc` and its needed Pion stack as required by the module graph), `gorilla/websocket`, and `fsnotify`. The CLI SHALL NOT take a direct dependency on a third-party clipboard library.

#### Scenario: No direct clipboard module
- **WHEN** inspecting `native/cli/go.mod` direct requires
- **THEN** `github.com/atotto/clipboard` is absent
- **AND** clipboard write is provided by an in-house package under `dropcli/libs/`

#### Scenario: Hard-to-replace stack kept
- **WHEN** inspecting `native/cli/go.mod` direct requires
- **THEN** Charmbracelet TUI packages, Pion WebRTC, `gorilla/websocket`, `fsnotify`, and `golang.org/x/sys` / `golang.org/x/term` remain available as direct dependencies

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

### Requirement: In-house clipboard write
The CLI SHALL write text to the system clipboard through an in-house helper (exposed to UI code as a single write-text entry point). The helper SHALL support Linux and Windows (the Drop CLI target platforms). On success, subsequent paste from the system clipboard yields that text. On failure, the helper SHALL return an error so existing PIN, share-link, and PIX copy UI can show failure feedback without crashing.

#### Scenario: Successful write
- **WHEN** the UI requests copying a non-empty string and the platform clipboard accepts it
- **THEN** the helper returns no error
- **AND** the system clipboard contains that string

#### Scenario: Windows write path exists
- **WHEN** building or running the CLI for Windows (`GOOS=windows`)
- **THEN** clipboard write is implemented for that OS (not an unsupported stub)
- **AND** a successful write leaves the text on the system clipboard

#### Scenario: Failed write
- **WHEN** the UI requests copying and no working clipboard backend is available
- **THEN** the helper returns an error
- **AND** the process remains running so the caller can show failure feedback

### Requirement: Supported operating systems
The Drop CLI module (`dropcli`) SHALL target only Linux and Windows. Building or compiling the module for any other `GOOS` (including Darwin/macOS) MUST fail. DIY packages under `dropcli/libs/` MUST NOT ship stub implementations whose sole purpose is returning an “unsupported platform” error for non-target operating systems.

#### Scenario: Linux and Windows compile
- **WHEN** building the CLI for `GOOS=linux` or `GOOS=windows`
- **THEN** the build succeeds for the packages required by the `dropcli` binary

#### Scenario: Other GOOS rejected
- **WHEN** building the CLI for a non-target `GOOS` such as `darwin`
- **THEN** the build fails due to missing platform implementations or explicit build constraints
- **AND** there is no DIY stub that compiles solely to return an unsupported-platform error

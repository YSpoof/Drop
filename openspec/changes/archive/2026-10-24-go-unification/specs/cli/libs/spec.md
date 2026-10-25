# Spec Delta

## MODIFIED Requirements

### Requirement: Allowed third-party direct dependencies

The unified native module (`dropnative`) SHALL declare the third-party direct dependencies used by its CLI and desktop packages only once. CLI packages SHALL keep the Charmbracelet TUI (`bubbletea`, `huh`, `lipgloss`), Pion WebRTC (`pion/webrtc` and its needed Pion stack as required by the module graph), `gorilla/websocket`, `fsnotify`, and `golang.org/x/sys` / `golang.org/x/term`. The CLI SHALL NOT take a direct dependency on a third-party clipboard library.

#### Scenario: No direct clipboard module
- **WHEN** inspecting `native/go.mod` direct requires
- **THEN** `github.com/atotto/clipboard` is absent
- **AND** clipboard write is provided by an in-house package under `dropnative/cli/libs/`

#### Scenario: Hard-to-replace stack kept
- **WHEN** inspecting `native/go.mod` direct requires
- **THEN** Charmbracelet TUI packages, Pion WebRTC, `gorilla/websocket`, `fsnotify`, and `golang.org/x/sys` / `golang.org/x/term` remain available as direct dependencies

### Requirement: DIY package naming

In-house libraries used by the CLI SHALL live under import paths of the form `dropnative/cli/libs/<short-name>`. Those packages MUST NOT be registered or `replace`d under another project's published module path (for example they MUST NOT pretend to be `github.com/...` upstream modules). The CLI SHALL use these DIY package directories: `clip` (clipboard write) and `breakread` (cancelable file read). It MUST NOT keep `libs/pty`, `libs/ptypair`, or `libs/cancelread`.

#### Scenario: Local import paths only
- **WHEN** application code imports a DIY helper (clipboard write or cancelable read)
- **THEN** the import path starts with `dropnative/cli/libs/`
- **AND** `native/go.mod` has no `replace` that maps an upstream module path onto that helper

#### Scenario: Renamed helpers
- **WHEN** code needs a cancelable file reader
- **THEN** it imports `dropnative/cli/libs/breakread`
- **AND** it does not import `dropnative/cli/libs/pty`, `dropnative/cli/libs/ptypair`, or `dropnative/cli/libs/cancelread`
- **AND** the `native/cli/libs/ptypair` package directory is absent

### Requirement: Supported operating systems

The Drop CLI binary SHALL target only Linux and Windows. Building the CLI command for any other `GOOS` (including Darwin/macOS) MUST fail. DIY packages under `dropnative/cli/libs/` MUST NOT ship stub implementations whose sole purpose is returning an "unsupported platform" error for non-target operating systems.

#### Scenario: Linux and Windows compile
- **WHEN** building the CLI command for `GOOS=linux` or `GOOS=windows`
- **THEN** the build succeeds for the packages required by the CLI binary

#### Scenario: Other GOOS rejected
- **WHEN** building the CLI command for a non-target `GOOS` such as `darwin`
- **THEN** the build fails due to missing platform implementations or explicit build constraints
- **AND** there is no DIY stub that compiles solely to return an unsupported-platform error

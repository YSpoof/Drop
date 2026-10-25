# Proposal

## Why

The CLI and desktop Go apps currently have separate modules, duplicated toolchain/dependency management, and app-specific import roots, even though they are two native surfaces for the same product. Unifying the module will preserve separate app boundaries and build outputs while creating a deliberate shared core for protocol and Pion session code that the desktop can adopt as native WebRTC work proceeds.

## What Changes

- Replace the nested CLI and desktop Go modules with one `native/go.mod` module (`dropnative`) using Go 1.27.3, the latest Go version currently used by both modules.
- Keep CLI and desktop implementation packages isolated under `native/cli` and `native/desktop`, with separate entry points and on-demand build commands.
- Move transport-independent transfer protocol and Pion session code into a shared `native/internal/webrtc` package, preserving the existing CLI behavior and leaving desktop's TypeScript WebRTC path unchanged for now.
- Update Go import paths, module sums, local build scripts, Docker builds, and CI toolchain image to use the unified module and matching Go version.
- Preserve the existing Linux and Windows binary names, targets, and separate build outputs.

## Capabilities

### New Capabilities
- `native-builds`: Build the CLI and desktop binaries independently from one Go module and shared native package tree.

### Modified Capabilities
- `cli/libs`: Update the documented module and in-house library import paths to the unified `dropnative` module while preserving CLI platform and dependency behavior.

## Impact

- Affected code: `native/cli`, `native/desktop`, a shared `native/internal/webrtc` package, Go build scripts, `Dockerfile`, and package scripts.
- Affected dependencies: merge both applications' direct dependencies into one module graph and reconcile `go.sum`.
- Build environments: align local and Docker Go toolchains at Go 1.27.3.
- Runtime behavior and published binary names remain unchanged. Moving desktop signaling and WebRTC from TypeScript to Go/Pion is explicitly deferred to a later change.

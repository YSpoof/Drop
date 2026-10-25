# Design

## Context

See proposal.md - Why. `native/cli` and `native/desktop` currently each have a Go module and their own import roots. Both declare Go 1.27.3. Their build scripts already produce separate Linux and Windows binaries, but the Docker build uses a Go builder image and compiles both apps from the unified module root. The CLI's `internal/webrtc` package contains transport protocol messages and the Pion session; desktop WebRTC currently remains in TypeScript.

## Goals / Non-Goals

**Goals:**
- Establish `native` as the sole module root with module path `dropnative` and Go 1.27.3.
- Preserve CLI/desktop package ownership, independently buildable entry points, current platform targets, and binary filenames.
- Provide a module-level shared package boundary for protocol and Pion session code without importing app-specific UI or host packages across apps.
- Keep current runtime behavior unchanged.

**Non-Goals:**
- Move desktop signaling or WebRTC from TypeScript to Go/Pion in this change.
- Combine the CLI TUI, settings, transfer orchestration, desktop RPC bridge, dialogs, or Chrome lifecycle into shared packages.
- Change transfer protocol behavior, binary names, or supported release targets.

## Decisions

### Use one module rooted at `native`

Create `native/go.mod` with module path `dropnative` and Go version 1.27.3; merge the current requirements and sums with `go mod tidy`. Remove the two nested module files after all package imports and builds resolve from the new root. This makes the two applications part of one dependency graph while keeping their source trees recognizable. A `go.work` file was not selected: workspaces coordinate multiple modules but would preserve the split dependency and module roots this change is meant to remove.

### Keep app-specific packages isolated

Retain `native/cli` and `native/desktop` as their respective application trees. Update imports to `dropnative/cli/...` and `dropnative/desktop/...`. Put intentionally shared packages under `native/internal/...`; Go's internal-package boundary allows both applications to consume these without either importing the other's private package tree. Do not create compatibility aliases for the old module paths.

### Move only protocol and Pion session code to the shared core

Move the existing CLI `internal/webrtc` package to `native/internal/webrtc` and update CLI references. Keep CLI services, state, adapters, and UI under `native/cli/internal`. Desktop does not consume the shared Pion package yet; it remains available for the separately planned desktop WebRTC migration. This avoids a speculative rewrite of the current TypeScript peer/session flow.

### Keep builds independent and pin the toolchain

Keep the existing output names and Linux/Windows x64 targets. Build the CLI package (`./cli/cmd/dropcli`) and desktop package (`./desktop`) independently from the `native` module root in their respective scripts and Docker build stage. Pin the Go build image to `golang:1.27.3-alpine` so CI satisfies the module directive while using a smaller builder image. Preserve `CGO_ENABLED=0` unless package compilation proves that a target requires cgo.

## Risks / Trade-offs

- [Risk] One module makes the union of both apps' dependencies available to every package and allows accidental cross-imports. → Mitigation: retain app-specific `internal` trees, place shared code only at `native/internal`, and add package-boundary checks during validation.
- [Risk] Merging module sums or changing import roots breaks one platform-specific build. → Mitigation: run tests and cross-build both CLI and desktop for Linux and Windows from the new root.
- [Risk] The pinned Go container tag may not be available in every mirror. → Mitigation: verify the tag in CI and update it together with the `go` directive when adopting a newer stable release.
- [Risk] Moving Pion protocol/session code could alter CLI negotiation or wire compatibility. → Mitigation: preserve package behavior and run existing CLI transfer/session tests; desktop continues using its current TypeScript implementation.

## Migration Plan

1. Create the unified module metadata and package/import layout, keeping CLI and desktop entry points separate.
2. Move the existing Pion protocol/session package to `native/internal/webrtc`; update imports and reconcile dependencies.
3. Update local scripts, package commands, Docker context/build commands, and Go image version.
4. Run module tests and Linux/Windows builds for each binary; verify binary names and independent target builds.
5. Roll back by reverting the module/import/build migration as one change if either app's build or behavior checks fail; no data migration is required.

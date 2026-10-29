# Proposal

## Why

Drop's web backend currently lives inside SvelteKit (adapter-node) as a Node process whose only responsibilities are WebSocket signaling and serving static assets, while the desktop and CLI native apps are already Go. This split prevents sharing protocol/types across surfaces, keeps a Node runtime in the production image, and complicates integration with the native Go apps. Moving the backend to Go (gin) and the frontend to adapter-static unifies the runtime and makes the signaling types shareable with the native apps.

## What Changes

- Move the entire SvelteKit application from the repository root into a new `frontend/` directory.
- Switch the frontend from `@sveltejs/adapter-node` to `@sveltejs/adapter-static`, producing a static build.
- Add a Go HTTP backend (gin) under the unified `native` module that serves the static frontend, the `/ws` signaling WebSocket, and `/downloads/*`.
- Port the signaling WebSocket handler from TypeScript to Go and move signaling message types into a shared `native/internal/signaling` package consumed by both the backend and the CLI.
- Update build scripts, Dockerfile, native dev workflow, Playwright config, and e2e imports for the new layout.
- Preserve all externally observable routes, WebSocket messages, and download paths (no behavior change).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is an implementation-only refactor; no requirements change.

## Impact

- `frontend/`: new home for the SvelteKit app (`src`, `static`, `tests`, `vite.config.ts`, `package.json`, etc.).
- Root Go module using standard layout: `cmd/backend`, `cmd/desktop`, `cmd/cli` for the three binaries and `internal/...` for shared packages (including `internal/signaling`); the legacy `native/` tree is migrated into this layout.
- `Dockerfile`, `scripts/`, `.dockerignore`, Playwright config, and CI workflows updated for the new layout.
- Node runtime removed from the production image; Go backend serves static assets.
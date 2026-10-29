# Design

## Context

See proposal.md - Why. The current web backend is SvelteKit's adapter-node server (`node build/server.js`) which only hosts the signaling WebSocket at `/ws` (see `src/lib/server/signaling/handler.ts`) and static files. Signaling types are duplicated between TypeScript (`src/lib/utils/signaling/types.ts`) and Go (`native/cli/internal/adapters/signaling/types.go`). The desktop and CLI currently share a unified Go module rooted at `native/` (`native/go.mod`, module `dropnative`); this change moves that module to the repository root under the module name `drop`.

## Goals / Non-Goals

**Goals:**
- Establish `frontend/` as the sole SvelteKit project and build it with adapter-static.
- Provide a Go backend (stdlib net/http) in the `drop` module that serves the static build, `/ws`, and `/downloads/*`.
- Share signaling message types between backend and CLI via `internal/signaling`.
- Keep dev workflow (Vite dev server on 4321 + Go backend proxy/origin) and e2e tests working.

**Non-Goals:**
- Changing the signaling wire protocol or any user-facing behavior.
- Moving WebRTC/Pion to Go (already deferred).
- Bundling the frontend into the Go binary via `embed` in the first iteration; the backend may serve from a configured directory (with embed as a follow-up).
- Rewriting the service worker.

## Decisions

### 1. Go module root and standard layout
- **Decision**: Move the Go module root to the repository root (`go.mod`, module path `drop`), and adopt the standard Go layout: binaries under `cmd/backend`, `cmd/desktop`, `cmd/cli`; shared packages under `internal/...` (including `internal/signaling`, `internal/webrtc`, `internal/fswatch`). Migrate the existing `native/` tree into this layout and remove `native/` once migration is complete.
- **Rationale**: The user-facing Go apps (backend, desktop, CLI) become first-class root-level apps; shared code lives in `internal/`, which is the idiomatic place and keeps it private to the module. This replaces the `native/`-rooted `dropnative` module with a root module named `drop`.
- **Alternatives considered**: Keeping `native/` as the module root (rejected: backend should not live under `native/`); a separate `backend/` module (duplicates deps and breaks type sharing).

### 2. Frontend layout
- **Decision**: Move the entire SvelteKit project (package.json, vite.config.ts, tsconfig.json, src, static, tests) into `frontend/`. Keep a thin root `package.json` with convenience scripts delegating to `frontend/`.
- **Rationale**: Keeps the Go module and frontend concerns separated; root scripts stay ergonomic for contributors and CI.
- **Alternatives considered**: Moving only `src/` (leaves config at root, confusing ownership); full removal of root package.json (breaks husky/tooling expectations).

### 3. Static adapter
- **Decision**: Replace `@sveltejs/adapter-node` with `@sveltejs/adapter-static`, configuring `fallback: 'index.html'` (or `200.html`) so deep links resolve, and keep prerendering enabled for `/` and `/share`.
- **Rationale**: Produces a deployable static bundle that the Go backend can serve; preserves SPA-style routing for the service worker and client-side routes.
- **Alternatives considered**: adapter-node behind a Go reverse proxy (keeps Node runtime, defeats the goal).

### 4. Static file serving (embedded)
- **Decision**: Embed the built frontend (`frontend/build`) into the Go backend binary using `//go:embed`, and serve it from an `embed.FS` with SPA fallback to `index.html`. `/downloads/*` is also embedded (or served from an embedded FS) so the result is a single deployable binary.
- **Rationale**: Single-binary deployment matches the native desktop packaging model and removes the need to ship `frontend/build` alongside the binary.
- **Alternatives considered**: Serving from `FRONTEND_DIR` on disk (simpler for dev, but requires shipping assets; kept as an override for local development via env/flag).

### 5. Signaling shared types
- **Decision**: Create `internal/signaling` containing the message structs and constants (SHARE_CODE_DIGITS is 4). Port the handler logic to a `Hub` type with mutex-protected peer/code maps. The CLI adapter's types are replaced by imports from this package (type aliases where wire names differ).
- **Rationale**: Eliminates duplication and lets the backend and CLI evolve together; `internal/` keeps the package private to the module.
- **Alternatives considered**: Code generation from TypeScript (adds tooling, fragile); keeping duplicate Go types in the backend only (reintroduces drift).

### 6. WebSocket implementation
- **Decision**: Use `github.com/gorilla/websocket` (already a dependency) with an upgrader, mirroring the TS handler's announce/join-code/signal/ping flow including public-IP validation.
- **Rationale**: Already used by the CLI and desktop; proven upgrade path.

### 7. Public IP validation
- **Decision**: Port `isPublicIpv4` from `src/lib/utils/net/privateIp.ts` into `internal/signaling` (or a small `internal/netutil` package) with identical semantics.

### 8. Dev workflow
- **Decision**: Keep Vite dev server on port 4321 for the frontend (HMR). The Go backend runs separately (e.g. port 8080) and only serves `/ws` (plus embedded static in prod). In dev, configure a Vite proxy `/ws -> backend` (or use `PUBLIC_BACKEND_URL`) so signaling still works.
- **Rationale**: Preserves fast HMR while exercising the Go backend and keeps frontend calls origin-relative.
- **Alternatives considered**: Serving the Vite build through the Go backend in dev (loses HMR).

### 9. Docker / CI
- **Decision**: Build frontend (`pnpm --dir frontend run build`), then build the Go backend, copying the static build and downloads into the final image. Remove the Node runtime from the final stage; final image runs the Go binary.
- **Rationale**: Single runtime, smaller image, matches unified Go toolchain.

### 10. Makefile for build/dev
- **Decision**: Add a root `Makefile` wrapping the common workflows (`build`, `dev`, `test`, `clean`) so contributors and CI use one entry point regardless of the frontend/Go split.
- **Rationale**: Avoids scattering commands across package.json, shell scripts, and Dockerfile; makes the new layout approachable.

## Risks / Trade-offs

- [Risk] adapter-static fallback and service worker caching interact; stale assets after deploy. → Mitigation: keep versioned cache names and test a production build smoke test.
- [Risk] Signaling handler port must match TS exactly or connections break. → Mitigation: add Go tests comparing JSON shapes and run e2e code-join scenarios against the Go backend.
- [Risk] Moving files breaks many relative imports and scripts. → Mitigation: do the move in one commit and update Playwright/e2e imports in the same change; run `pnpm check` and `go build ./...`.
- [Risk] `SHARE_CODE_RANGE` is `5 ** 4 = 625` (not 10000) in TS; preserve exactly in Go to avoid behavior drift.
- [Risk] Embedded frontend requires the build step to run before `go build`, otherwise stale/missing assets. → Mitigation: Makefile/CI build frontend first; `go:embed` path validated in CI; dev mode can override with `FRONTEND_DIR`.

## Migration Plan

1. Create `frontend/` and move SvelteKit project; update root scripts.
2. Switch adapter to static and verify `pnpm --dir frontend run build`.
3. Add `internal/signaling` shared types and port handler; update CLI adapter imports.
4. Add `cmd/backend` (stdlib) backend; wire static, downloads, /ws.
5. Update Dockerfile, scripts, native-dev, Playwright, e2e imports.
6. Run `go build ./...`, `pnpm --dir frontend run check`, Playwright smoke.

Rollback: revert the migration commit; no data migration required.

## Open Questions

None.
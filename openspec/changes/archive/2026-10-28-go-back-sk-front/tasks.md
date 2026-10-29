# Tasks

## 1. Scaffold frontend directory

- [x] 1.1 Move the SvelteKit project (package.json, vite.config.ts, tsconfig.json, src/, static/, tests/) into `frontend/` and verify `frontend/package.json` exists with the same dependencies
- [x] 1.2 Add thin root `package.json` convenience scripts delegating to `frontend/` (dev, build, check, test:e2e) and verify `pnpm run build` from root invokes the frontend build
- [x] 1.3 Update `.gitignore`/`.dockerignore` paths for `frontend/.svelte-kit`, `frontend/build`, and verify ignored paths are still excluded

## 2. Switch to adapter-static

- [x] 2.1 Replace `@sveltejs/adapter-node` with `@sveltejs/adapter-static` in `frontend/package.json` and `frontend/vite.config.ts`, configuring fallback to `index.html`, and verify `pnpm --dir frontend install` succeeds
- [x] 2.2 Run `pnpm --dir frontend run build` and verify `frontend/build/index.html` is produced
- [x] 2.3 Update `frontend/vite.config.ts` dev server with a proxy for `/ws` to the Go backend, and verify Vite dev server starts on 4321

## 3. Migrate Go module to repository root

- [x] 3.1 Create root `go.mod` (module `drop`) and move `native/cli`, `native/desktop`, `native/internal` into `cmd/cli`, `cmd/desktop`, `internal/...`, updating import paths, and verify `go build ./...` passes
- [x] 3.2 Remove the legacy `native/` directory (and its go.mod) after migration and verify no references to `dropnative/` remain
- [x] 3.3 Update build scripts and Dockerfile paths from `native/...` to root `cmd/...`, and verify `scripts/build-cli.sh` still produces the same binary names

## 4. Shared signaling types in Go

- [x] 4.1 Create `internal/signaling` package with message structs, constants (`SHARE_CODE_DIGITS = 4`, `SHARE_CODE_RANGE = 5**4`), and `isPublicIpv4` helper, and verify `go build ./internal/...` passes
- [x] 4.2 Move CLI signaling adapter to import types from `internal/signaling` and verify `go test ./cmd/cli/...` passes
- [x] 4.3 Add a `Hub` type with mutex-protected peer/code maps implementing announce, join-code, signal, ping, and peer removal, and verify unit tests cover code allocation and join rejection

## 5. Go backend (stdlib)

- [x] 5.1 Add `cmd/backend` package with stdlib net/http router, `/ws` upgrade handler wired to `signaling.Hub`, and verify `go build ./cmd/backend/...` passes
- [x] 5.2 Embed `frontend/build` (and downloads) into the backend binary via `//go:embed` and serve from the embedded FS with SPA fallback, with an optional `FRONTEND_DIR` override for dev, and verify a local request to `/` returns index.html
- [x] 5.3 Add graceful shutdown and config via env/flags (PORT, FRONTEND_DIR, DOWNLOADS_DIR) and verify `go run ./cmd/backend` starts and listens

## 6. Dev workflow and e2e

- [x] 6.1 Update `scripts/native-dev.sh` to run the Go backend and Vite dev server together, and verify desktop app connects to the dev origin
- [x] 6.2 Update Playwright `webServer` command and `baseURL` if ports changed, and update e2e imports from `../../src/lib/consts.ts` to `../../frontend/src/lib/consts.ts`, verifying `pnpm exec playwright test --list` succeeds
- [x] 6.3 Update `scripts/build-desktop.sh` output paths if affected and verify binaries still build

## 7. Docker and CI

- [x] 7.1 Update Dockerfile to build frontend with adapter-static before `go build` so assets are embedded, then build the single Go backend binary, verifying the build stages succeed
- [x] 7.2 Remove Node runtime from final stage and set CMD to the Go backend, verifying the image runs and serves `/`

## 8. Makefile and developer ergonomics

- [x] 8.1 Add root `Makefile` with targets `build` (build frontend then embed into Go binary), `dev` (backend + Vite), `test` (Go tests + Playwright), and `clean`, and verify `make build` succeeds
- [x] 8.2 Document Makefile targets in README or a short dev note, and verify documented commands run as written

## 9. Integration verification

- [x] 9.1 Run `go build ./...` and `pnpm --dir frontend run check` and verify both succeed
- [x] 9.2 Run Playwright smoke (code-join connection scenario) against the Go backend and verify signaling still works end-to-end
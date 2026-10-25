# Tasks

## 1. Unify the Go module and shared package

- [x] 1.1 Create `native/go.mod` for `dropnative` at Go 1.27.3, merge dependency requirements and sums, remove nested module files, update application import roots, and verify `cd native && go mod tidy && go test ./...` succeeds.
- [x] 1.2 Move the CLI protocol and Pion session package to `native/internal/webrtc`, update its consumers, and verify existing protocol and session tests pass.
- [x] 1.3 Audit application imports so CLI and desktop use only their own private packages plus shared `native/internal` packages; verify with `go list` and repository import searches.

## 2. Preserve independent local builds

- [x] 2.1 Update CLI, desktop, and native development scripts to build or run their own package from the unified module; verify each command succeeds independently and preserves its current output name.
- [x] 2.2 Update package scripts to expose separate on-demand CLI and desktop builds; verify invoking each script does not build the other application.

## 3. Align container builds

- [x] 3.1 Update the Docker Go build stage to copy the unified native module and build both targets separately with the Go 1.27.3 Alpine image; verify the container build produces all four existing Linux/Windows binary names.

## 4. Verify migration compatibility

- [x] 4.1 Run `cd native && go test ./... && go vet ./...` and verify all native packages pass.
- [x] 4.2 Cross-build CLI and desktop independently for Linux x64 and Windows x64 with `CGO_ENABLED=0`; verify the CLI build still fails for a non-target OS such as Darwin.
- [x] 4.3 Run the native development command and verify Vite and the desktop host start together with the expected port and authentication bootstrap parameters.

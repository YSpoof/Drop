# Tasks

## 1. Shared raw event source

- [x] 1.1 Add `native/internal/fswatch` to construct and expose a raw fsnotify event source with event/error channels, `Add`, `Remove`, and `Close`; add focused tests verifying construction, directory registration, raw event delivery, and clean closure.

## 2. CLI integration

- [x] 2.1 Update the CLI watcher adapter to consume the shared source while preserving its current port event mapping and shutdown behavior; run the CLI watcher tests and verify they pass.

## 3. Desktop integration

- [x] 3.1 Update the desktop watcher manager to consume the shared source while retaining recursive registration, filtering, settling, and emitted events; run desktop watcher tests and verify they pass.

## 4. Integration verification

- [x] 4.1 Run `go test ./...` from `native/` and verify all native packages pass with both applications using the shared raw event source.

# Tasks

## 1. Platform support (Linux/Windows only)

- [x] 1.1 Delete `libs/clip/write_other.go` and add `//go:build linux || windows` (or equivalent) so non-target GOOS cannot compile clip — verify `GOOS=darwin go build ./libs/clip/...` fails and `GOOS=linux` / `GOOS=windows` succeed
- [x] 1.2 Retag `libs/breakread/reader_other.go` from `!linux` to `windows` (keep linux implementation) — verify `GOOS=windows go test ./libs/breakread/...` and `GOOS=linux go test ./libs/breakread/...` pass; `GOOS=darwin` fails
- [x] 1.3 Add `//go:build linux || windows` on `cmd/dropcli` (and any other root packages that would otherwise build empty) — verify `GOOS=darwin go build ./cmd/dropcli` fails with a clear constraint/missing-impl error

## 2. Remove ptypair and rewrite hostkeys tests

- [x] 2.1 Delete `libs/ptypair/` entirely and remove all imports — verify `ls libs/ptypair` is gone and `go list ./libs/...` has no ptypair
- [x] 2.2 Rewrite `internal/ui/quick/hostkeys_test.go` to exercise host-key / cancelable-read behavior without a PTY (pipes, temp files + `breakread`, or narrower unit seams) — verify `go test ./internal/ui/quick/...` passes on linux

## 3. Deadcode and test-only helper cleanup

- [x] 3.1 Remove unused runner options `WithWatcherPort`, `WithSessionConfig`, `WithOutput` (and any now-unused fields) — verify `deadcode -test=false ./internal/ui/quick/...` no longer reports them and `go test ./internal/ui/quick/...` passes
- [x] 3.2 Remove `FolderWatcherService.Dir`, `DequeueAll`, and `QueueLen`; rewrite `watcher_test.go` to assert via production-used APIs — verify `go test ./internal/services/...` passes and those symbols are gone
- [x] 3.3 Move `state.NewTestStore` into test-only code (e.g. `store_test.go` helper or inline) so production packages do not export it — verify `deadcode -test=false ./internal/state/...` is clean and state/donation/form tests still pass
- [x] 3.4 Remove `tui.NewConfirmModel` if unused by production; update `confirm_test` to use `NewConfirmOverlay` or equivalent — verify `go test ./internal/ui/tui/...` passes
- [x] 3.5 Confirm `RunConfigMenu` and `CopyDonationPIX` remain (do not delete) — verify both symbols still exist and `go test` covering form/donation still pass
- [x] 3.6 Re-run `deadcode -test=false ./...` under `native/cli` and clear remaining true dead exports introduced or left by this change (except intentionally kept Configurações helpers) — verify the report is empty or only lists documented keepers


## 4. Split oversized source files

- [x] 4.1 Split `internal/ui/quick/runner.go` per design (config / runner core / session / inbox / transfer wiring) with move-only edits — verify each resulting `.go` file is under ~450 lines and `go test ./internal/ui/quick/...` passes
- [x] 4.2 Split `internal/ui/tui/inbox.go` per design (model/update, search, selection, tree, view helpers) with move-only edits — verify each resulting `.go` file is under ~450 lines and `go test ./internal/ui/tui/...` passes
- [x] 4.3 Split `internal/services/transfer.go` into control vs send (and core type) files — verify each file under ~450 lines and `go test ./internal/services/ -run Transfer` passes
- [x] 4.4 Split `internal/services/download.go` into pending/meta vs stream handlers — verify each file under ~450 lines and `go test ./internal/services/ -run Download` passes
- [x] 4.5 Split `internal/services/transfer_test.go` into helpers + scenario files each under ~450 lines — verify `go test ./internal/services/ -count=1` still passes
- [x] 4.6 Scan `native/cli` for any remaining `.go` files over ~450 lines and split if found — verify `find … -name '*.go' | xargs wc -l` shows none above the threshold (except vendor-none; this tree has none)

## 5. Integration verification

- [x] 5.1 Run full `go test ./...` in `native/cli` on linux — verify all packages pass
- [x] 5.2 Cross-check Windows: `GOOS=windows go test ./libs/...` and `GOOS=windows go build ./cmd/dropcli` — verify success
- [x] 5.3 Confirm Darwin rejected: `GOOS=darwin go build ./cmd/dropcli` fails — verify non-zero exit and no unsupported stub path left under `libs/`

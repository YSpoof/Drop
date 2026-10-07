# Tasks

## 1. In-house clipboard (`clip`)

- [x] 1.1 Add `native/cli/libs/clip` with `Write(text string) error`, Linux (`wl-copy` → `xclip` → `xsel`), Windows (`clip.exe` stdin), and `other` (incl. Darwin) unsupported error; verify `go build ./libs/clip/...` and `GOOS=windows go build ./libs/clip/...` from `native/cli`
- [x] 1.2 Point `internal/ui/clipboard.go` at `dropcli/libs/clip` and remove `github.com/atotto/clipboard` usage; verify `go build ./internal/ui/...` and `go.mod` no longer lists atotto after `go mod tidy`

## 2. Rename DIY helpers

- [x] 2.1 Move `libs/pty` → `libs/ptypair` (package name `ptypair`), update all imports; verify no remaining `dropcli/libs/pty` references and `go test ./internal/ui/quick/...` passes
- [x] 2.2 Move `libs/cancelread` → `libs/breakread` (package name `breakread`), update all imports; verify no remaining `dropcli/libs/cancelread` references and `go test ./internal/ui/quick/...` passes

## 3. Dependency whitelist check

- [x] 3.1 Confirm direct requires match kept set (Charmbracelet TUI, Pion WebRTC, gorilla/websocket, fsnotify, `golang.org/x/sys`, `golang.org/x/term`) plus stdlib only; verify with `go list -f '{{if not .Indirect}}{{.Path}}{{end}}' -m all` from `native/cli` and that `go.mod` has no `replace` of upstream paths onto `libs/`

## 4. Integration smoke

- [x] 4.1 Build whole CLI module (`go build ./...` from `native/cli`) and run existing unit tests that touch renamed packages / UI (`go test ./libs/... ./internal/ui/...`); verify green

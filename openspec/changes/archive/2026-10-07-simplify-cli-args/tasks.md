# Tasks

## 1. Flag parse + config model

- [x] 1.1 Rewrite `NewFlagSet` / `ParseArgs` for short flags only (`-q`, `-s`, `-c`, `-o`) with positionals via `fs.Args()`, remove `-f`/`-d`/`-url`/`-name` and all long aliases, map host to `-s`, and verify `go test ./internal/ui/quick/ -run Parse` fails on removed flags and accepts `-q -s -o` plus file args
- [x] 1.2 Replace `QuickConfig.File`/`Dir`/`DeviceName`/`WSURL` with positional path fields (`Paths` + validated `SendFiles` / `WatchDirs`), update `ValidateWithRepo` to classify mix of files and dirs (multiple dirs OK; reject only missing/invalid paths), and verify validation unit coverage in `runner_test.go`
- [x] 1.3 Wire `-h` / `-help` / `--help` to custom pt-BR usage (host no longer on `-h`) and update `text` usage strings (`UsageQuickHost` etc.) to `-q -s [paths…]` / `-q -c <pin>`; verify `dropcli -h` prints new synopsis and exits 0/help path

## 2. Runner send/watch behavior

- [x] 2.1 Change `Runner.Run` to use validated `SendFiles` / `WatchDirs` from positionals; implement multi-file send-once plus multi-dir watch (exit only when files-only after successful send; stay if any watch dir) keeping reconnect rules; verify `go test ./internal/ui/quick/` passes for updated cases
- [x] 2.2 Remove applying `cfg.WSURL` / `cfg.DeviceName` from runner/main arg path so signaling URL is only default + `DROP_WS_URL`; verify no `-url` references remain under `native/cli` (`rtk grep`) and settings still pick up `DROP_WS_URL`

## 3. Interactive composition

- [x] 3.1 Update `main.run` / `runInteractive` so `-s`/`-c`/`-o`/paths without `-q` skip or partially skip `RunForm` (role/PIN from flags, apply `-o`, `ReceiveInbox: true`, `AutoDownload: false`) and pass queued paths into the runner; verify by code review + building `go build ./cmd/dropcli`
- [x] 3.2 Ensure paths without `-s`/`-c` still show mode selection, retain positionals, and queue sends after ready while inbox handles inbound; verify build succeeds and bare `dropcli` still reaches interactive form

## 4. Tests + docs cleanup

- [x] 4.1 Update `runner_test.go` (and any other Go tests citing old flags) to new argv shapes; do not add new test files unless required for compile; verify `go test ./...` under `native/cli` passes
- [x] 4.2 Grep repo docs/examples/README for old `-h` host / `-f` / `-d` / `-url` CLI examples and update to new surface; verify no stale dropcli flag examples remain in touched docs

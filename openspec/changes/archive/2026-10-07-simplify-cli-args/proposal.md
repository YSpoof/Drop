# Proposal

## Why

DropCli exposes too many flags (`-f`, `-d`, `-url`, `-name`, long aliases) for a small tool. Operators want a short, memorable surface: host/join/output/quiet, with send paths as positionals (like `cat`), and signaling URL only via env.

## What Changes

- **BREAKING**: Replace the flag surface with short flags only:
  - `-q` — skip interactive UI (quick/headless); implies auto-download
  - `-s` — host/share session (replaces `-h` for host)
  - `-c <pin>` — connect/join with PIN
  - `-o <dir>` — download/output directory
  - `-h` / help — show usage (Go `-help` / `--help` remain valid)
- **BREAKING**: Remove `-f` / `-file`, `-d` / `-dir`, `-url`, `-name`, and long aliases (`--quick`, `--host`, `--connect`, `--output`, etc.).
- **BREAKING**: Send inputs become positional arguments after flags: any mix of files and/or directories (space-separated, like `cat`).
  - Files: queue all, send after peer ready (order unspecified).
  - Directories: recursive watch until cancel (multiple dirs allowed).
  - Files-only: process MAY exit after successful send-once. If any directory is present, process stays for watch (and still sends file positionals once).
- Flags may be used without `-q`: CLI runs the full interactive UI (inbox / session chrome) while applying host/join/output/paths.
- Paths without `-s`/`-c`: start interactive mode and queue those paths for send after the user picks host/join (and PIN if joining).
- **BREAKING**: Signaling WebSocket URL is env-only (`DROP_WS_URL`); remove `-url` override from CLI args.
- Device display name is no longer a launch flag; interactive settings (`Configurações`) remain the place to edit name and reset transfer stats.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `cli/session`: Simplify launch flags, positional send paths, `-s` host / `-h` help, interactive+flags composition, remove device-name and URL flags from launch surface.
- `cli/file-transfer`: Update send/watch scenarios that reference `-f` / `-d` to positional paths.
- `cli/signaling`: Clarify signaling URL comes only from default or `DROP_WS_URL` (no CLI flag).

## Impact

- `native/cli/internal/ui/quick` — `QuickConfig`, `NewFlagSet`, `ParseArgs`, `Validate*`, send/watch loops (multi-file send).
- `native/cli/cmd/dropcli` — interactive path when flags/paths present without `-q`; stop applying `-url`.
- `native/cli/internal/ui/text` — usage/help strings for new synopsis.
- `native/cli/internal/ui/quick/runner_test.go` and any docs/examples citing old flags.
- Existing scripts using `-h` for host, `-f`/`-d`, `-url`, or long forms break and must migrate.

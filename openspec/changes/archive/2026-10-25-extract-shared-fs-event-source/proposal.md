# Proposal

## Why

The CLI watcher adapter and desktop watcher manager both own low-level fsnotify event delivery and lifecycle plumbing. Extracting only that raw event source reduces duplicated integration code while preserving the applications' distinct watcher behavior and contracts.

## What Changes

- Add a shared internal raw filesystem event source in the native Go module.
- Route the CLI watcher adapter and desktop watcher manager through that source.
- Keep event translation and all application-specific watcher policies local to each application.
- Preserve existing behavior; this is a refactor with no spec-level behavior change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is an implementation-only refactor; no requirements change.

## Impact

- `native/internal/`: new shared low-level fsnotify wrapper.
- `native/cli/internal/adapters/watcher/`: consumes the shared raw source and retains CLI port event mapping.
- `native/desktop/internal/watcher/`: consumes the shared raw source and retains recursive watching, filtering, settle detection, and bridge event behavior.
- No public API, wire format, dependency, or observable behavior changes are intended.

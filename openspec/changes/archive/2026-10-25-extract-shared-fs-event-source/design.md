# Design

## Context

See `proposal.md` for motivation. The CLI watcher adapter currently owns an fsnotify instance and forwards its raw operations into CLI port events. The desktop manager owns another fsnotify instance and adds recursive registration, hidden-file filtering, write-settling, and desktop-specific event emission. Those policies remain distinct.

## Goals / Non-Goals

**Goals:**
- Centralize raw fsnotify creation, event/error channel access, directory add/remove, and close lifecycle in `native/internal/fswatch`.
- Preserve raw fsnotify events so consumers retain control over operation interpretation.
- Keep both application-facing event contracts unchanged.

**Non-Goals:**
- Share recursive tree traversal, hidden-file rules, symlink handling, event settling, deduplication, or event translation.
- Change watcher behavior, bridge messages, CLI ports, or dependencies.

## Decisions

- Expose a small source abstraction around one `fsnotify.Watcher`, including `Events`, `Errors`, `Add`, `Remove`, and `Close`. Events remain `fsnotify.Event` values; errors remain errors. This shares the repeated resource and channel plumbing without imposing policy.
- Keep lifecycle ownership explicit: consumers create and close a source, and retain responsibility for their own goroutine shutdown and app-specific coordination. The shared package should not add a second event-forwarding goroutine unless channel ownership proves it necessary; prefer exposing fsnotify's channels directly.
- The CLI adapter continues mapping fsnotify operations to `ports.WatchEvent`; the desktop manager continues recursive registration, filtering hidden paths, settling file writes, and emitting `watcher.Event`.
- Keep the package under `native/internal` so it is reusable by both native applications but not a public external API. A generic watcher framework or shared traversal helper would couple currently different policies and is unnecessary for this extraction.

## Risks / Trade-offs

- [A thin wrapper may add little value if it only forwards fsnotify methods] -> Keep it responsible for construction and a consistent source interface; if that cannot remove lifecycle duplication, reconsider whether the abstraction is worthwhile.
- [Consumers may observe subtly different channel-close behavior during shutdown] -> Preserve fsnotify channel semantics and add focused tests for event/error access and close behavior alongside existing CLI and desktop tests.
- [Desktop and CLI behavior could accidentally change during adoption] -> Keep policy code in place and verify existing watcher tests and package-level behavior without broadening the extraction.

## Migration Plan

Introduce the shared source, migrate the CLI adapter and desktop manager independently, and run the existing watcher tests for both applications. Rollback is local: restore either consumer to direct fsnotify use without changing public contracts or data formats.

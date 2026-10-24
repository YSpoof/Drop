# Design

## Context

See proposal.md for motivation. The current SvelteKit application is organized around injected browser/native ports, transfer services, and utility modules. A normal `svelte-check` is clean, but TypeScript's unused-symbol diagnostics identify dead members that the default compiler configuration does not report. Repository-wide searches also identify utility exports with no consumers.

The cleanup must not alter provider registration, WebRTC control/data handling, native streamer behavior, route configuration, or service-worker entry points. `src/lib/server/signaling/handler.ts` is an exception to ordinary import tracing because `vite.config.ts` loads its exported handler by name; it must remain intact.

## Goals / Non-Goals

**Goals:**

- Remove only symbols confirmed unused by strict compiler diagnostics and repository-wide reference searches.
- Preserve all side effects, dependency injection behavior, transfer callbacks, and externally loaded entry points.
- Leave the codebase with clean standard checks plus strict unused-local/parameter analysis.

**Non-Goals:**

- No redesign of transfer architecture or provider interfaces.
- No changes to user-visible behavior, protocols, persistence, routes, native packaging, or dependencies.
- No speculative removal based only on file size, naming, or lack of nearby tests.

## Decisions

### Use compiler diagnostics as the primary scope boundary

The implementation will first remove the confirmed unused members reported by `tsc --noUnusedLocals --noUnusedParameters`: `TransferService.downloads`, `TransferManager.downloads`, `TransferManager.environment`, and the unused `groupId` parameter in `QueueService.addWatchedFile`. This is preferable to manually pruning broadly because the compiler identifies local dead code without guessing about runtime entry points.

### Remove only repository-unreferenced utility exports after a full search

The implementation will verify and remove the currently unreferenced helpers `streamerSession`, `formatEta`, `formatPercent`, `totalQueueBytes`, and `isPrivateIp`, retaining their modules' used exports and shared private helpers. Exported SvelteKit/configuration hooks and the Vite-loaded `handleSignalingConnection` are explicitly excluded even if normal source import counts do not find them.

### Validate behavior through static and application checks

After cleanup, run standard Svelte diagnostics, strict TypeScript unused-symbol diagnostics, the existing Playwright suite, and the production build. This combination catches missing imports and type issues while exercising the main browser flows without adding new runtime behavior or test infrastructure.

## Risks / Trade-offs

- [Risk] A dynamically referenced helper could be mistaken for dead code → Mitigation: search the whole repository, inspect configuration/plugin entry points, and preserve framework/config exports.
- [Risk] Removing unused injected fields could accidentally remove required construction side effects → Mitigation: inspect the injected classes and retain all injections used for behavior; only remove fields whose values are never read and whose constructors are not required for setup.
- [Risk] Existing integration tests may depend on environment-specific binaries or services → Mitigation: run the documented checks and report any unrelated environmental failure separately rather than broadening the cleanup.

## Migration Plan

1. Apply the narrowly scoped removal and parameter cleanup.
2. Run strict type checks, Svelte checks, build, and existing end-to-end tests.
3. Deploy as a normal source-only cleanup; rollback is a single commit revert if validation or production monitoring reveals an unexpected regression.

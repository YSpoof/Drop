# Proposal

## Why

The application contains code that is provably unused by the current TypeScript/Svelte dependency graph, including unused dependency injections, an unused callback argument, and helper exports with no consumers. Removing these paths will reduce maintenance and bundle noise while preserving the existing transfer, native-shell, and browser behavior.

## What Changes

- Remove confirmed unused fields, imports, and callback parameters identified by strict compiler analysis.
- Remove unreferenced utility exports and their now-unneeded implementation code after checking repository-wide consumers.
- Keep all public application behavior, provider wiring, transfer protocols, routes, and native/browser fallbacks unchanged.
- Re-run static checks and production validation to confirm that the cleanup introduces no missing references or runtime regressions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a behavior-preserving cleanup with no requirement-level change; specs are intentionally skipped.

## Impact

- Affected area: TypeScript utilities and transfer services under `src/lib/`, limited to symbols confirmed unused by repository-wide searches and compiler diagnostics.
- No API, protocol, storage, UI, or user-visible behavior changes are intended.
- Validation will use `pnpm exec svelte-check --tsconfig ./tsconfig.json --tsgo`, strict TypeScript unused-symbol analysis, the existing test suite, and a production build.

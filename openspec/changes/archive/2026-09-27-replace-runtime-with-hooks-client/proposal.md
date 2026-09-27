# Proposal

## Why

`src/lib/runtime.ts` exists only as a side-effect import from `src/routes/+layout.svelte`. That import is the composition root: it calls `configure()` and, when native, `startNeutralino()`. Import order in the layout is what keeps that work ahead of any `inject()`. SvelteKit already runs `src/hooks.client.ts` once when the client app starts, before the root layout module loads. The layout import is the wrong place for that bootstrap.

## What Changes

- Add `src/hooks.client.ts` and move the bootstrap there: choose native or web providers, call `configure()` once, then `startNeutralino()` when native.
- Delete `src/lib/runtime.ts`.
- Remove `import "#lib/runtime.js"` from `src/routes/+layout.svelte`.
- No user-visible behavior change. Platform choice, Neutralino startup, and first-`inject()` service construction stay as they are.

## Capabilities

### New Capabilities

- None. This is a pure refactor. Externally observable behavior does not change, so no new spec is introduced.

### Modified Capabilities

- None. `donation-reminder` and `file-transfer` requirements stay as they are. `skip_specs: true` is set because this change does not alter spec-level behavior.

## Impact

- `src/hooks.client.ts` (new), `src/lib/runtime.ts` (removed), `src/routes/+layout.svelte` (drop the side-effect import).
- No other file imports `#lib/runtime.js`.
- Client-only. `src/routes/+layout.ts` already sets `ssr = false`. No server hook and no server container.
- No new dependency. No tests.

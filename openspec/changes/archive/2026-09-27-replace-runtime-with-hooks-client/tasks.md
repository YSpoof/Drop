# Tasks

## 1. Client hook

- [x] 1.1 Add `src/hooks.client.ts` that exports `init` as `ClientInit`. Body matches current `src/lib/runtime.ts`: `configure(native ? nativeProviders : webProviders)`, then `startNeutralino()` only when `isNative()` is true. Verify the file has no top-level `configure` or `startNeutralino` call, no `inject(`, and no export besides `init`.

## 2. Remove the layout composition root

- [x] 2.1 Remove `import "#lib/runtime.js"` from `src/routes/+layout.svelte` and delete `src/lib/runtime.ts`. Verify `+layout.svelte` no longer mentions `runtime`, `src/lib/runtime.ts` is gone, and no file imports `#lib/runtime.js`.

## 3. Check

- [x] 3.1 Run `pnpm check` and verify it exits 0. No new tests.

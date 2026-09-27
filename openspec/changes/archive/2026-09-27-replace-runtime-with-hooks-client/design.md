# Design

## Context

See proposal.md — Why. `src/lib/runtime.ts` is eleven lines and exports nothing:

```ts
const native = isNative();
configure(native ? nativeProviders : webProviders);
if (native) startNeutralino();
```

`src/routes/+layout.svelte` imports `#lib/runtime.js` for that side effect. Nothing else imports it. `src/routes/+layout.ts` sets `ssr = false`. `inject()` runs from class fields and from functions or Svelte instance scripts, never at module scope.

SvelteKit client startup awaits `hooks.init` and only then loads the root layout module (`@sveltejs/kit` `client.js` `_start`).

## Goals / Non-Goals

**Goals:**

- One `configure()` call, on the client, before the root layout module evaluates.
- `startNeutralino()` still runs after `configure()`, and only when `isNative()` is true.
- `src/lib/runtime.ts` and the layout import are gone.

**Non-Goals:**

- Changing provider arrays, ports, or call sites.
- A server container or `src/hooks.server.ts`.
- Moving analytics, `pageUnload`, or anything else out of the layout.
- Tests.

## Decisions

### Bootstrap lives in `init`, not at module top level

`src/hooks.client.ts` exports `init` typed as `ClientInit`. The body is the current `runtime.ts` body, unchanged. The file exports nothing else.

Kit calls `init` once, before `default_layout_loader()` loads `+layout.svelte`. That is the ordering the layout import was papering over. `startNeutralino()` stays synchronous and stays after `configure()`, so the Neutralino client is up before a later `inject()` can reach a native adapter.

Alternative: paste the same statements at the top of `hooks.client.ts` with no `init`. The hooks module evaluates before `_start`, so sync top-level code also runs before the layout. Rejected. `init` is the hook Kit waits on before loading the layout. Later async startup stays in that same function and delays hydration, which is what the hook is for.

Alternative: keep `runtime.ts` and import it from `hooks.client.ts`. Rejected. The file would still exist only as a side effect, which is what this change removes.

### The layout import goes away in the same change

`+layout.svelte` drops `import "#lib/runtime.js"`. A leftover import runs `configure()` again when the layout module loads, after `init`. A second `configure()` drops cached singletons for those tokens.

`src/lib/runtime.ts` is deleted. No re-export from another module.

### Client hook only

`ssr` stays `false`. Components that call `inject()` do not render on the server, so there is no server `configure()`. `hooks.server.ts` is not added. `hooks.ts` (shared) is not added: `isNative()` and `startNeutralino()` touch `window`.

## Risks / Trade-offs

- [Second `configure()` drops singletons] → `init` is the only caller. The layout import and `runtime.ts` are removed together.
- [Unconfigured abstract port is constructed as an empty object] → `init` finishes before the root layout module loads. No file calls `inject()` at module scope, including the modules `hooks.client.ts` imports (`isNative`, the provider arrays, `startNeutralino`).
- [`init` delays first paint if it becomes async] → Keep the body synchronous. `startNeutralino()` already queues native calls until the socket is ready.

## Migration Plan

1. Add `src/hooks.client.ts` with `init`.
2. Remove the runtime import from `+layout.svelte` and delete `src/lib/runtime.ts`.
3. Run `pnpm check`. No new tests.
4. Rollback is reverting the change. No stored data and no flag.

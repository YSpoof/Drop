# Design

## Context

See proposal.md for why. Observed failure: packaged chrome-mode app loads `https://drop.lzart.com.br`, then `@neutralinojs/lib` `init()` opens:

`ws://drop.lzart.com.br:65173/?connectToken=…`

Library host selection (v6.10.0):

```js
const host = window.NL_GINJECTED || window.NL_CINJECTED
  ? "127.0.0.1"
  : window.location.hostname;
new WebSocket(`ws://${host}:${window.NL_PORT}?connectToken=…`);
```

Chrome mode does not document `injectGlobals` (window-mode only). Auth globals (`NL_TOKEN`, `NL_PORT`) can still be present without `NL_CINJECTED` / `NL_GINJECTED`, so the library picks the page hostname. Framework socket stays plain `ws://` by design (no WSS).

Bootstrap today: `hooks.client.ts` → `isNative()` → `startNeutralino()` → `init()`.

## Goals / Non-Goals

**Goals:**

- Force framework WS host to `127.0.0.1` with plain `ws://` for every native shell start.
- Do the injection in client bootstrap before `init`.

**Non-Goals:**

- TLS / `wss://` on the framework port.
- Changing `neutralino.config.json` `url`, `defaultMode`, or port.
- Changing Drop signaling WebSocket (`wss://` to the site).
- Changing streamer sidecar protocol (already uses `127.0.0.1`).

## Decisions

### Set `NL_CINJECTED` in `hooks.client.ts` before `startNeutralino`

When `isNative()` is true, set `window.NL_CINJECTED = true` (or keep existing true) before awaiting `startNeutralino()`. That is the flag `@neutralinojs/lib` already checks for chrome-injected globals; setting it makes `init` use `127.0.0.1` without patching the library or monkey-patching `WebSocket`.

Alternative: set `NL_GINJECTED` (window/webview path) — same host effect; prefer `NL_CINJECTED` because production shell is chrome mode.

Alternative: patch `@neutralinojs/lib` or fork URL construction — rejected; fragile across upgrades.

Alternative: change config `url` to local HTTP — rejected; product keeps remote HTTPS UI.

### Keep injection at hooks, not inside `startNeutralino` only

User-required surface is `hooks.client.ts`. A one-liner (or tiny helper called from hooks) is enough. Prefer calling a small `prepareNeutralinoBridge()` from the native adapter if types/comments need a home, but the call site that runs before `startNeutralino` stays in hooks.

### Types

Extend `Window` with optional `NL_CINJECTED` / `NL_GINJECTED` / existing `NL_TOKEN` / `NL_PORT` if TypeScript complains. Only as needed for the injection line.

## Risks / Trade-offs

- [Chrome still blocks `ws://127.0.0.1` from HTTPS as mixed content] → User chose loopback plain `ws` as the fix; verify on packaged binary. If still blocked after host fix, follow up with chrome `args` — out of this change’s decided scope.
- [Library changes host selection in a future `@neutralinojs/lib`] → Re-check `init` URL construction on client upgrades; flag names are public Neutralino globals.
- [Setting `NL_CINJECTED` without real chrome injection] → Only set when `isNative()` already saw `NL_TOKEN`; web path unchanged.

## Migration Plan

1. Ship client bootstrap change with the web/native bundle.
2. Rebuild packaged desktop binaries so users get the new client JS from the remote origin (remote UI) — no local resource embed required for this fix if UI is loaded from production.
3. Smoke: launch packaged app, confirm no mixed-content error and native APIs work (folder pick / streamer ready).

Rollback: remove the injection line; behavior returns to hostname-based `ws://`.

# Proposal

## Why

Packaged native shell sometimes boots as plain web: client `init` checks `NL_TOKEN` once, and if Neutralino has not injected credentials yet, DI gets web providers and never opens the framework socket. Native features (folder pick, streamer, etc.) stay missing until a full reload that happens to win the race.

## What Changes

- Client bootstrap waits for native shell credentials (`NL_TOKEN` on `window` or `sessionStorage`) by polling every 250ms for up to 1.5s before choosing native vs web providers.
- While that poll runs (credentials missing on the first check), show a simple fullscreen boot loading screen: centered app logo (primary box with water-sync icon) using `animate-bounce`.
- If credentials appear within the window, configure native providers, set loopback injection, and start Neutralino as today; then dismiss the loading screen.
- If credentials never appear, dismiss the loading screen and stay on the silent web path (no warn, no toast) — same as a normal browser.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `native-shell`: Require deferred native detection with a short poll window so late Neutralino credential injection still selects the native path; show a boot loading screen during the wait; keep silent web fallback when credentials never arrive.

## Impact

- `src/hooks.client.ts` (and possibly a small wait/splash helper next to `isNative` / native adapter).
- Boot splash markup/styles (imperative overlay and/or `app.html` shell) so something visible runs while `ClientInit` awaits (hydration is blocked until `init` resolves).
- Existing `isNative()` predicate reused; poll policy and splash lifecycle live in bootstrap.
- Packaged chrome-mode app and normal browsers both hit the poll path when the token is missing at first check (up to 1.5s with splash).
- No change to framework WS host rules (`NL_CINJECTED` / loopback), streamer launch, or Neutralino config.

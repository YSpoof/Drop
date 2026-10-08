# Design

## Context

See proposal.md for why. Today `hooks.client.ts` calls `isNative()` once, then `configure(...)` and optionally `startNeutralino()`. `isNative()` is true only when `window.NL_TOKEN` or `sessionStorage.NL_TOKEN` exists. `app.html` loads `__neutralino_globals.js` from the local framework; with `tokenSecurity: one-time`, credentials can land after the first sync check.

SvelteKit awaits client `init` before hydration, so a Svelte layout splash alone cannot paint during the poll. Splash must be visible without waiting on the hydrated app tree.

## Goals / Non-Goals

**Goals:**

- Poll for credentials every 250ms for up to 1.5s when the first check fails.
- Show a minimal fullscreen splash during that wait only; dismiss when bootstrap decides.
- Keep existing loopback `NL_CINJECTED` + `startNeutralino` path when native wins.
- Silent web fallback (no toast/warn) when the window expires.

**Non-Goals:**

- Changing Neutralino config, globals script URL, or token security mode.
- Changing framework WS host rules from `fix-native-ws-connection`.
- Fancy branded marketing splash, progress bar, or copy.
- Re-configuring DI after first `configure` (one decision per boot).

## Decisions

### Poll helper around existing `isNative`

Add a small async helper (e.g. `waitForNative(timeoutMs = 2000, intervalMs = 250)`) next to `isNative` that:

1. Returns true immediately if `isNative()`.
2. Otherwise loops: `await` interval, re-check `isNative()`, until true or elapsed ≥ timeout.
3. Returns the final boolean.

`hooks.client.ts` uses that result for `configure` / `startNeutralino` the same way as today’s sync check.

Alternative: fixed single delay — rejected; user chose poll.

Alternative: poll only when `NL_PORT` present — rejected for now; no confirmed early signal; accept up to 1.5s on plain web with splash.

### Splash via imperative overlay in bootstrap (not Svelte layout)

At the start of the poll path (first `isNative()` false), create/show a fullscreen overlay on `document.body` (or reveal a pre-placed node in `app.html` if that is cleaner for FOUC). Markup matches NavBar brand mark: primary box + water-sync icon, centered, logo element has `animate-bounce`. Prefer Tailwind utility classes already in the app build when the overlay is created after CSS is available; if CSS is not yet applied, inline the minimal layout styles and still apply `animate-bounce` when utilities exist (or equivalent keyframes inline).

Remove the overlay in a `finally` after configure + optional `startNeutralino` so both native and web paths clear it.

Alternative: Svelte component gated by a store — rejected as sole mechanism because `ClientInit` blocks hydration; optional later enhancement only if splash must persist after hydrate (not required).

Alternative: always show splash including immediate-native path — rejected; spec says no splash when credentials already present.

### Keep `configure` after the wait, still inside `init`

Do not call `configure` before the poll finishes. Components that `inject()` must only run after `init` resolves, which remains true if the wait stays inside `ClientInit`.

### Silent failure

No `console.warn` requirement, no toast. Existing `console` noise from streamer extract stays out of scope.

## Risks / Trade-offs

- [Up to 1.5s blank/splash on every normal browser cold start] → Mitigated by splash UX; timeout capped at 1.5s; skip wait when token already present.
- [FOUC / unstyled splash if overlay mounts before CSS] → Prefer `app.html` stub with inline flex/center/bg + brand colors, or inject minimal inline styles with the overlay.
- [Race still loses if token arrives after 1.5s] → Accept; reload still recovers; do not extend without new evidence.
- [SSR HTML visible under overlay] → Overlay must cover viewport (`fixed inset-0`, high z-index) until removed.

## Migration Plan

1. Ship client bootstrap + splash with the web bundle (remote UI picks it up for packaged app).
2. Smoke packaged app: cold start with delayed globals still gets native features; splash appears then clears.
3. Smoke normal browser: splash up to ~1.5s then web UI; no native toast.

Rollback: restore sync `isNative()` + remove splash helper/overlay.

## Open Questions

- None for planning; exact overlay DOM home (`app.html` vs createElement in hooks) left to implementer as long as scenarios hold.

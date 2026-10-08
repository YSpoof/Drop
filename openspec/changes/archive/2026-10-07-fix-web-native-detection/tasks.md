# Tasks

## 1. Native wait helper

- [x] 1.1 Add `waitForNative` (or equivalent) next to `isNative` that returns immediately when credentials exist, otherwise polls every 250ms for up to 1.5s, and verify a small unit test covers immediate true, late true within window, and false after timeout
- [x] 1.2 Wire `hooks.client.ts` to await that helper before `configure` / `NL_CINJECTED` / `startNeutralino`, and verify native path still runs when credentials are present and web path runs when they are not (no warn/toast on web fallback)

## 2. Boot splash

- [x] 2.1 Implement fullscreen boot overlay (imperative DOM and/or `app.html` stub) with centered primary box + water-sync icon using `animate-bounce`, shown only when the first credential check fails, and verify it appears during the poll and is removed in `finally` after bootstrap decides
- [x] 2.2 Confirm immediate-native boot skips the overlay (credentials already present) by manual or automated check of the no-splash path

## 3. Integration smoke

- [x] 3.1 Smoke packaged native app cold start: splash may appear briefly, then native features work (framework loopback / folder pick or streamer ready)
- [x] 3.2 Smoke normal browser cold start: splash up to ~1.5s, then web UI with no native missing-credential toast

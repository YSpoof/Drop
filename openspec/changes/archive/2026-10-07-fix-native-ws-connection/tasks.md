# Tasks

## 1. Loopback injection before Neutralino init

- [x] 1.1 In `hooks.client.ts`, when `isNative()` is true, set `window.NL_CINJECTED = true` before `await startNeutralino()`, and verify TypeScript accepts the assignment (add `Window` typing only if needed)
- [x] 1.2 Run `pnpm check` and verify it passes with the hooks change

## 2. Packaged shell smoke

- [x] 2.1 Launch the packaged native app against the HTTPS UI and verify the framework WebSocket connects to `ws://127.0.0.1:<NL_PORT>` (no mixed-content error to `drop.lzart.com.br:65173`) and a basic native call still works (e.g. streamer ready or folder pick)

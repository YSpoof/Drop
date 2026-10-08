# Proposal

## Why

The packaged native app loads the UI from `https://drop.lzart.com.br` and then opens Neutralino’s framework socket. `@neutralinojs/lib` builds that URL as `ws://{hostname}:{NL_PORT}` unless injection flags are set, so the built app tries `ws://drop.lzart.com.br:65173` from an HTTPS page. Browsers block that as mixed content and throw `SecurityError`, so native APIs never initialize.

## What Changes

- Before Neutralino `init`, ensure the client library targets the local framework host `127.0.0.1` with plain `ws://` (not the page hostname, not `wss://`).
- Perform that injection from client bootstrap (`hooks.client.ts`) when running inside the native shell.
- Keep remote HTTPS UI, chrome mode, and framework port behavior otherwise unchanged.

## Capabilities

### New Capabilities

- `native-shell`: How the desktop shell connects the remote HTTPS UI to the local Neutralino framework WebSocket so native APIs can initialize.

### Modified Capabilities

- (none)

## Impact

- `src/hooks.client.ts` (and possibly a tiny helper next to the native adapter).
- Window typing for Neutralino injection globals if needed (`src/app.d.ts` or adapter types).
- Packaged chrome-mode app against `https://drop.lzart.com.br`; streamer sidecar handshake still depends on a successful framework `init`.
- No change to signaling WebSocket (`wss://` to Drop servers), Neutralino config URL/mode, or framework TLS.

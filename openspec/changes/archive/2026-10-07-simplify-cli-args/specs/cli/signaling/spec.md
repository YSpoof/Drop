# Spec Delta

## MODIFIED Requirements

### Requirement: Signaling endpoint resolution
The client SHALL connect directly to the signaling WebSocket URL, defaulting to `https://drop.lzart.com.br/ws` (normalized to `wss://drop.lzart.com.br/ws`), or the URL specified in the `DROP_WS_URL` environment variable if present. The client SHALL normalize `http://` to `ws://` and `https://` to `wss://`. The CLI SHALL NOT accept a command-line flag that overrides the signaling URL; only the default and `DROP_WS_URL` apply.

#### Scenario: Default URL resolution
- **WHEN** `DROP_WS_URL` is unset
- **THEN** the client connects to `wss://drop.lzart.com.br/ws`

#### Scenario: Custom environment URL resolution
- **WHEN** `DROP_WS_URL` is set to `http://localhost:5173/ws`
- **THEN** the client connects to `ws://localhost:5173/ws`

#### Scenario: No CLI URL override
- **WHEN** the user attempts to pass a signaling URL via a CLI flag (e.g. former `-url`)
- **THEN** the CLI rejects the unknown/removed flag and does not change the resolved signaling URL

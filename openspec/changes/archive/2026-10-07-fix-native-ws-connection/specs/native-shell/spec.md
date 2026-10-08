# Spec Delta

## Purpose

Connects the desktop shell’s remote HTTPS UI to the local Neutralino framework over a loopback plain WebSocket so native APIs can initialize in the packaged app.

## ADDED Requirements

### Requirement: Framework socket uses loopback plain WebSocket

When the app runs inside the native shell and opens the Neutralino framework connection, it SHALL connect to `127.0.0.1` on the framework port using plain `ws://`. It MUST NOT use the page hostname (for example the remote HTTPS origin host) as the WebSocket host. It MUST NOT use `wss://` for this framework connection.

#### Scenario: Packaged app on remote HTTPS UI

- **WHEN** the packaged native shell loads the UI from the HTTPS production origin and starts Neutralino
- **THEN** the framework WebSocket URL host is `127.0.0.1` and the scheme is `ws`

#### Scenario: Web browser has no framework socket

- **WHEN** the app runs in a normal browser without native shell credentials
- **THEN** no Neutralino framework WebSocket is opened

### Requirement: Loopback target is set before Neutralino init

The native client bootstrap SHALL establish the loopback framework-host targeting before Neutralino `init` runs, so the client library does not fall back to `location.hostname`.

#### Scenario: Init sees loopback injection

- **WHEN** native bootstrap is about to call Neutralino `init`
- **THEN** the runtime already indicates framework globals were injected (so the client library selects `127.0.0.1`)

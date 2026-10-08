# native-shell Specification

## Purpose

Connects the desktop shell’s remote HTTPS UI to the local Neutralino framework over a loopback plain WebSocket so native APIs can initialize in the packaged app.

## Requirements

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

### Requirement: Providers configured after Neutralino startup succeeds

Client bootstrap SHALL attempt Neutralino startup (framework init, extension binary extract, and streamer ready) before choosing DI providers. When startup completes successfully, the client MUST configure native providers. When startup fails or the streamer is not ready within 2 seconds, the client MUST configure web providers and MUST NOT show a warning or toast about the failure.

#### Scenario: Successful startup selects native

- **WHEN** Neutralino startup completes successfully (framework connected and streamer ready)
- **THEN** the client configures native providers

#### Scenario: Failed or timed-out startup selects web

- **WHEN** Neutralino startup fails or the streamer is not ready within 2 seconds
- **THEN** the client configures web providers and shows no warning or toast about the failure

#### Scenario: Native providers only after ready

- **WHEN** bootstrap is still awaiting Neutralino startup
- **THEN** neither native nor web providers have been configured yet

### Requirement: Boot loading screen until providers configured

During client bootstrap, the client SHALL show a fullscreen loading screen with the app logo centered — a primary-colored box containing the water-sync icon — and that logo MUST use the `animate-bounce` animation class. The loading screen MUST remain until providers have been configured (native or web) and MUST be dismissed afterward.

#### Scenario: Splash while bootstrapping

- **WHEN** client bootstrap has not yet configured providers
- **THEN** a fullscreen loading screen is visible with the centered bouncing app logo (primary box with water-sync icon)

#### Scenario: Splash dismissed after providers configured

- **WHEN** bootstrap finishes configuring native or web providers
- **THEN** the fullscreen loading screen is no longer shown

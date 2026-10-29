# native-shell Specification

## Purpose

Connects the desktop shell’s remote HTTPS UI to the local Go native host over a loopback plain WebSocket so native APIs can initialize in the packaged app.

## Requirements

### Requirement: Framework socket uses loopback plain WebSocket

When the app runs inside the native shell and opens the native host connection, it SHALL connect to `127.0.0.1` on the announced native port using plain `ws://` and provide the process authentication token. It MUST NOT use the page hostname as the WebSocket host. It MUST NOT use `wss://` for this framework connection.

#### Scenario: Packaged app on remote HTTPS UI

- **WHEN** the packaged native shell loads the UI from the HTTPS production origin and starts the native host connection
- **THEN** the WebSocket URL host is `127.0.0.1`, the scheme is `ws`, and the request includes the process token

#### Scenario: Web browser has no framework socket

- **WHEN** the app runs in a normal browser without native shell credentials
- **THEN** no native host WebSocket is opened

### Requirement: Bootstrap credentials passed via launch parameters

When the Go native shell launches Chrome, it SHALL provide the loopback port and session authentication token via query parameters in the initial `--app` URL. The client bootstrap SHALL read and sanitize these parameters before initializing the native bridge.

#### Scenario: Launch with bootstrap query parameters

- **WHEN** the Go native shell launches the browser window
- **THEN** the initial URL contains the loopback port and authentication token

#### Scenario: Sanitize URL after reading credentials

- **WHEN** the client initializes and reads the bootstrap credentials
- **THEN** it removes the credentials from the browser address bar

### Requirement: Providers configured after Go native host startup succeeds

Client bootstrap SHALL attempt Go native host connection (WebSocket connection and token handshake) before choosing DI providers. When startup completes successfully within 2 seconds, the client MUST configure native providers. When connection fails or times out, the client MUST configure web providers and MUST NOT show a warning or toast about the failure.

#### Scenario: Successful connection selects native

- **WHEN** Go native host startup completes successfully within 2 seconds
- **THEN** the client configures native providers

#### Scenario: Failed or timed-out startup selects web

- **WHEN** Go native host startup fails or times out after 2 seconds
- **THEN** the client configures web providers and shows no warning or toast

### Requirement: Window lifecycle terminates shell process

When the Chrome window is closed by the user, the Go native shell process SHALL detect the browser exit and terminate itself cleanly.

#### Scenario: Chrome close terminates Go shell

- **WHEN** the user closes the Chrome window
- **THEN** the Go native shell process exits cleanly

### Requirement: Boot loading screen until providers configured

During client bootstrap, the client SHALL show a fullscreen loading screen with the app logo centered — a primary-colored box containing the water-sync icon — and that logo MUST use the `animate-bounce` animation class. The loading screen MUST remain until providers have been configured (native or web) and MUST be dismissed afterward.

#### Scenario: Splash while bootstrapping

- **WHEN** client bootstrap has not yet configured providers
- **THEN** a fullscreen loading screen is visible with the centered bouncing app logo (primary box with water-sync icon)

#### Scenario: Splash dismissed after providers configured

- **WHEN** bootstrap finishes configuring native or web providers
- **THEN** the fullscreen loading screen is no longer shown

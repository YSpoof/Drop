# Spec Delta

## Purpose

Connects the desktop shell's remote HTTPS UI to the local desktop host over a loopback plain WebSocket so desktop APIs can initialize in the packaged app.

## ADDED Requirements

### Requirement: Host socket uses loopback plain WebSocket

When the app runs inside the desktop shell and opens the desktop host connection, it SHALL connect to `127.0.0.1` on the announced host port using plain `ws://` and provide the process authentication token. It MUST NOT use the page hostname as the WebSocket host. It MUST NOT use `wss://` for this connection.

#### Scenario: Packaged app on remote HTTPS UI

- **WHEN** the packaged desktop shell loads the UI from the HTTPS production origin and starts the desktop host connection
- **THEN** the WebSocket URL host is `127.0.0.1`, the scheme is `ws`, and the request includes the process token

#### Scenario: Web browser has no host socket

- **WHEN** the app runs in a normal browser without desktop shell credentials
- **THEN** no desktop host WebSocket is opened

### Requirement: Bootstrap credentials passed via launch parameters

When the desktop host launches the browser window, it SHALL provide the loopback port and session authentication token via query parameters in the initial `--app` URL. The client bootstrap SHALL read and sanitize these parameters before initializing the desktop bridge.

#### Scenario: Launch with bootstrap query parameters

- **WHEN** the desktop host launches the browser window
- **THEN** the initial URL contains the loopback port and authentication token

#### Scenario: Sanitize URL after reading credentials

- **WHEN** the client initializes and reads the bootstrap credentials
- **THEN** it removes the credentials from the browser address bar

### Requirement: Providers configured after desktop host startup succeeds

Client bootstrap SHALL attempt the desktop host connection (WebSocket connection and token handshake) before choosing DI providers. When startup completes successfully within 2 seconds, the client MUST configure desktop providers. When connection fails or times out, the client MUST configure web providers and MUST NOT show a warning or toast about the failure.

#### Scenario: Successful connection selects desktop

- **WHEN** desktop host startup completes successfully within 2 seconds
- **THEN** the client configures desktop providers

#### Scenario: Failed or timed-out startup selects web

- **WHEN** desktop host startup fails or times out after 2 seconds
- **THEN** the client configures web providers and shows no warning or toast

### Requirement: Window lifecycle terminates host process

When the browser window is closed by the user, the desktop host process SHALL detect the browser exit and terminate itself cleanly.

#### Scenario: Window close terminates the host

- **WHEN** the user closes the browser window
- **THEN** the desktop host process exits cleanly

### Requirement: Boot loading screen until providers configured

During client bootstrap, the client SHALL show a fullscreen loading screen with the app logo centered — a primary-colored box containing the water-sync icon — and that logo MUST use the `animate-bounce` animation class. The loading screen MUST remain until providers have been configured (desktop or web) and MUST be dismissed afterward.

#### Scenario: Splash while bootstrapping

- **WHEN** client bootstrap has not yet configured providers
- **THEN** a fullscreen loading screen is visible with the centered bouncing app logo (primary box with water-sync icon)

#### Scenario: Splash dismissed after providers configured

- **WHEN** bootstrap finishes configuring desktop or web providers
- **THEN** the fullscreen loading screen is no longer shown

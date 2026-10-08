# Spec Delta

## ADDED Requirements

### Requirement: Deferred native credential detection

Before the client chooses native or web providers, it SHALL treat native shell credentials as present when `NL_TOKEN` is available on `window` or in `sessionStorage`. When credentials are absent on the first check, the client SHALL poll for them every 250ms until they appear or until 1.5 seconds have elapsed since the first check, whichever comes first. If credentials appear within that window, the client MUST configure the native path and start the Neutralino framework connection. If credentials never appear within that window, the client MUST configure the web path and MUST NOT open a Neutralino framework WebSocket. That web fallback MUST NOT show a warning or toast about missing native credentials.

#### Scenario: Late credentials select native

- **WHEN** the packaged native shell loads the UI and `NL_TOKEN` is missing on the first bootstrap check but appears within 1.5 seconds
- **THEN** the client configures the native path and starts the Neutralino framework connection

#### Scenario: Immediate credentials skip waiting

- **WHEN** `NL_TOKEN` is already present on the first bootstrap check
- **THEN** the client configures the native path without waiting for the poll window to elapse

#### Scenario: No credentials stay silent web

- **WHEN** the app runs without native shell credentials for the full 1.5 second poll window
- **THEN** the client configures the web path, opens no Neutralino framework WebSocket, and shows no warning or toast about missing native credentials

### Requirement: Boot loading screen during native detection wait

While bootstrap is polling for native shell credentials (credentials missing on the first check), the client SHALL show a fullscreen loading screen with the app logo centered — a primary-colored box containing the water-sync icon — and that logo MUST use the `animate-bounce` animation class. The loading screen MUST be dismissed when bootstrap finishes choosing native or web (credentials found or poll window elapsed). When credentials are already present on the first check, the client MUST NOT show this loading screen.

#### Scenario: Splash while polling

- **WHEN** bootstrap starts polling because `NL_TOKEN` is missing on the first check
- **THEN** a fullscreen loading screen is visible with the centered bouncing app logo (primary box with water-sync icon)

#### Scenario: Splash dismissed after decision

- **WHEN** bootstrap finishes the poll (credentials found or 1.5 seconds elapsed)
- **THEN** the fullscreen loading screen is no longer shown

#### Scenario: No splash when already native

- **WHEN** `NL_TOKEN` is already present on the first bootstrap check
- **THEN** the fullscreen boot loading screen is not shown

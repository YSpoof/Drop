# Proposal

## Why

Drop web/desktop already nudges a PIX contribution every 25 calm home opens. CLI users never see that reminder, so frequent terminal users miss the same ask. Bring the same interval-based donation prompt (and always-available PIX in settings) to DropCli.

## What Changes

- Count every CLI process start as one visit (including `-q`), persisted separately from web/desktop in `~/.dropConfig`.
- When the reminder is due, show a TUI donation prompt only on the interactive mode menu (`Gerar um código` / `Possuo um código` / `Configurações` when offered) — never mid-session and never in quick mode.
- Prompt copy matches web: title `Gostou do Drop?`, free-app + PIX body, copyable PIX key, **Fechar** dismisses and advances the interval; no permanent opt-out.
- Add an always-available PIX copy control in CLI `Configurações` (parallel to **Sobre o App**), independent of the automatic reminder.
- Quick mode still increments the visit count but never shows the reminder UI; due state waits for a later interactive mode menu.

## Capabilities

### New Capabilities

- `cli/donation-reminder`: CLI visit counting, due interval, mode-menu prompt with PIX copy, and the always-on PIX block in `Configurações`.

### Modified Capabilities

- `cli/session`: interactive `Configurações` form also offers the project PIX key and a copy control (alongside device name, download directory, and reset-stats).

## Impact

- `native/cli`: `state.Config` / `Settings` / `Store` for visit + anchor persistence; new donation reminder helper; TUI prompt before/around `RunForm` mode selection; `RunConfigMenu` PIX block; pt-BR strings in `text`.
- Shared PIX key value must match web (`siteData.donationPixKey`); hardcode or constant in CLI (no web runtime dependency).
- No protocol, signaling, or transfer behavior changes. Web/desktop `donation-reminder` unchanged.

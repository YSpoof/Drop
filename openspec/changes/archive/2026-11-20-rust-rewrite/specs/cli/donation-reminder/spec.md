# Spec Delta

## MODIFIED Requirements

### Requirement: CLI visit count persists per device

The CLI SHALL count one visit for each process start on that device (interactive and quick mode) and SHALL persist the count across restarts in the CLI config store. Separate invocations of the CLI process SHALL each increment the count. The CLI visit count MUST NOT be shared with the web/desktop visit count.

#### Scenario: Interactive start increments

- **WHEN** the user starts the CLI without `--quick`
- **THEN** the stored CLI visit count for that device increases by one

#### Scenario: Quick mode start increments

- **WHEN** the user starts the CLI with `--quick`
- **THEN** the stored CLI visit count for that device increases by one

#### Scenario: Count survives a later run

- **WHEN** the user exits the CLI and starts it again on the same device
- **THEN** the visit count continues from the stored value

### Requirement: Reminder appears only on the interactive mode menu

The CLI SHALL show the due donation reminder only when presenting the interactive mode menu (role selection: `Gerar um código` / `Possuo um código`, and `Configurações`). The CLI MUST NOT show the reminder in quick mode (`--quick`), during an active host/join session, on the PIN wait surface, in the receive inbox, or on wait-to-reconnect. When the reminder is due but the mode menu is not shown (including `--quick`, or interactive launch that skips the mode menu via `--host`/`--code`), the CLI MUST keep the reminder due and MUST NOT show it. The CLI SHALL show it the next time that mode menu is presented while the reminder remains due.

#### Scenario: Mode menu shows the reminder

- **WHEN** the reminder is due and the CLI presents the interactive mode menu
- **THEN** the donation reminder prompt is shown before or as part of that menu flow

#### Scenario: Quick mode defers the reminder

- **WHEN** the reminder becomes due (or is already due) during a `--quick` run
- **THEN** the donation reminder prompt is not shown and the reminder stays due

#### Scenario: Role flags skip the menu and defer

- **WHEN** the reminder is due and the user launches interactive mode with `--host` or `--code` (mode menu skipped)
- **THEN** the donation reminder prompt is not shown and the reminder stays due

#### Scenario: Active session does not show the reminder

- **WHEN** the reminder is due and the user is on host PIN wait, inbox, or wait-to-reconnect
- **THEN** the donation reminder prompt is not shown and the reminder stays due

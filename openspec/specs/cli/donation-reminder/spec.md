# CLI Donation Reminder Specification

## Purpose

Ask CLI users for a PIX contribution on the same 25-run interval as web/desktop, only on the interactive mode menu, and keep an always-available PIX copy control in Configurações.

## Requirements

### Requirement: CLI visit count persists per device

The CLI SHALL count one visit for each process start on that device (interactive and quick mode) and SHALL persist the count across restarts in the CLI config store. Separate invocations of the CLI process SHALL each increment the count. The CLI visit count MUST NOT be shared with the web/desktop visit count.

#### Scenario: Interactive start increments

- **WHEN** the user starts the CLI without `-q`
- **THEN** the stored CLI visit count for that device increases by one

#### Scenario: Quick mode start increments

- **WHEN** the user starts the CLI with `-q`
- **THEN** the stored CLI visit count for that device increases by one

#### Scenario: Count survives a later run

- **WHEN** the user exits the CLI and starts it again on the same device
- **THEN** the visit count continues from the stored value

### Requirement: CLI donation reminder becomes due every 25 visits

The CLI SHALL mark a donation reminder due when the CLI visit count reaches 25 and again every 25 process starts after the previous reminder is dismissed. While a reminder is already due, further starts MUST NOT queue a second reminder. Dismissing the reminder SHALL clear the due state and start the next 25-run interval from that dismissal.

#### Scenario: First reminder at 25 runs

- **WHEN** a process start makes the stored CLI visit count 25 and no reminder is already due
- **THEN** the donation reminder becomes due

#### Scenario: Runs before the interval do not prompt

- **WHEN** the stored CLI visit count is below 25, or fewer than 25 process starts have happened since the last dismissal
- **THEN** the donation reminder is not due

#### Scenario: A blocked interval does not stack

- **WHEN** a reminder is already due and the user starts the CLI again before dismissing it
- **THEN** the CLI still has one due reminder

#### Scenario: Dismissal starts the next interval

- **WHEN** the user dismisses a due reminder on visit N
- **THEN** the reminder is not due again until a later process start makes the visit count N + 25

### Requirement: Reminder appears only on the interactive mode menu

The CLI SHALL show the due donation reminder only when presenting the interactive mode menu (role selection: `Gerar um código` / `Possuo um código`, and `Configurações` when that option is offered). The CLI MUST NOT show the reminder in quick mode (`-q`), during an active host/join session, on the PIN wait surface, in the receive inbox, or on wait-to-reconnect. When the reminder is due but the mode menu is not shown (including `-q`, or interactive launch that skips the mode menu via `-s`/`-c`), the CLI MUST keep the reminder due and MUST NOT show it. The CLI SHALL show it the next time that mode menu is presented while the reminder remains due.

#### Scenario: Mode menu shows the reminder

- **WHEN** the reminder is due and the CLI presents the interactive mode menu
- **THEN** the donation reminder prompt is shown before or as part of that menu flow

#### Scenario: Quick mode defers the reminder

- **WHEN** the reminder becomes due (or is already due) during a `-q` run
- **THEN** the donation reminder prompt is not shown and the reminder stays due

#### Scenario: Role flags skip the menu and defer

- **WHEN** the reminder is due and the user launches interactive mode with `-s` or `-c` (mode menu skipped)
- **THEN** the donation reminder prompt is not shown and the reminder stays due

#### Scenario: Active session does not show the reminder

- **WHEN** the reminder is due and the user is on host PIN wait, inbox, or wait-to-reconnect
- **THEN** the donation reminder prompt is not shown and the reminder stays due

### Requirement: Donation reminder prompt offers the PIX key

The donation reminder prompt SHALL use the same user-visible title and body idea as web/desktop: title `Gostou do Drop?`, and text that Drop is free and a PIX contribution helps keep the project going. It SHALL show the project's existing PIX key and SHALL copy that key to the clipboard when the user activates the copy control. A successful copy SHALL be indicated in the UI. A failed copy MUST leave the prompt open and MUST NOT show the success indication. The prompt SHALL provide a **Fechar** action. Dismissing via **Fechar** (or the equivalent dismiss control for that prompt) SHALL clear the due reminder. Copying the key MUST NOT clear the due reminder. The prompt MUST NOT offer a control that permanently stops future reminders. If the process exits without dismissing while the prompt is shown, the reminder SHALL remain due on a later mode-menu presentation.

#### Scenario: Copy succeeds

- **WHEN** the user activates the PIX key copy control and the clipboard accepts the key
- **THEN** the clipboard contains the project's PIX key and the UI shows success

#### Scenario: Copy fails

- **WHEN** the user activates the PIX key copy control and the clipboard rejects the key
- **THEN** the prompt stays open and the UI does not show success

#### Scenario: Fechar clears the reminder

- **WHEN** the user activates **Fechar**
- **THEN** the prompt closes and the reminder is no longer due

#### Scenario: Copy does not dismiss

- **WHEN** the user copies the PIX key and does not dismiss the prompt
- **THEN** the reminder stays due

#### Scenario: Exit without dismissing keeps it due

- **WHEN** the reminder prompt is shown and the process exits without dismissing it
- **THEN** the reminder is still due on a later interactive mode menu

### Requirement: Configurações keeps its donation block

The automatic reminder MUST NOT remove or replace the donation block in CLI `Configurações`. Opening `Configurações` SHALL show the project's existing PIX key and a control that copies it to the clipboard, with the same success and failure feedback rules as the reminder prompt. Interacting with that settings PIX control MUST NOT clear a due reminder by itself.

#### Scenario: Configurações still offers the PIX key

- **WHEN** the user opens `Configurações`
- **THEN** the settings UI shows the PIX key and a control that copies it

#### Scenario: Settings copy does not dismiss the reminder

- **WHEN** a reminder is due and the user copies the PIX key from `Configurações` without dismissing the reminder prompt
- **THEN** the reminder stays due

# Spec Delta

## ADDED Requirements

### Requirement: Left-aligned host-wait terminal lines
While the host is waiting for a peer and showing the assigned PIN (including copy hints and copy success/failure feedback), each new status line printed to the terminal SHALL begin at column 0. Lines MUST NOT cascade rightward (staircase indent) across successive messages on a TTY.

#### Scenario: PIN and copy hint stay left-aligned
- **WHEN** the signaling server assigns a host PIN and the CLI prints the PIN and the copy-key hint on a TTY
- **THEN** each of those lines starts at the left margin of the terminal

#### Scenario: Copy feedback stays left-aligned
- **WHEN** the host presses `c` or `C` during PIN wait and the CLI prints copy success or failure feedback on a TTY
- **THEN** each feedback line starts at the left margin of the terminal

### Requirement: Ctrl+C confirm-to-exit overlay
On a TTY, when the user presses Ctrl+C (or equivalent interrupt) during any session wait surface — host PIN wait, quick receive/wait, wait-to-reconnect, or interactive inbox — the CLI SHALL NOT exit on that first press. Instead it SHALL show a full-viewport (alt-screen) overlay in pt-BR that tells the user to press Ctrl+C again to exit or press ESC to continue. While the overlay is visible, a second Ctrl+C SHALL confirm exit; ESC SHALL dismiss the overlay and resume the prior wait UI (including host copy-key actions when that surface is active). Non-TTY / non-interactive runs are out of scope for this overlay.

#### Scenario: First Ctrl+C shows confirm overlay on host PIN wait
- **WHEN** the CLI is hosting and waiting for a peer on a TTY and the user presses Ctrl+C once
- **THEN** a full-viewport overlay appears in pt-BR instructing the user to press Ctrl+C again to exit or ESC to continue
- **AND** the session wait does not end solely because of that first press

#### Scenario: First Ctrl+C shows confirm overlay on receive wait
- **WHEN** the CLI is in quick receive/wait mode on a TTY and the user presses Ctrl+C once
- **THEN** the same confirm overlay appears and the receive wait does not end solely because of that first press

#### Scenario: First Ctrl+C shows confirm overlay while waiting to reconnect
- **WHEN** the CLI is waiting to reconnect on a TTY and the user presses Ctrl+C once
- **THEN** the same confirm overlay appears and the wait-to-reconnect does not end solely because of that first press

#### Scenario: First Ctrl+C shows confirm overlay in interactive inbox
- **WHEN** the interactive inbox is showing on a TTY and the user presses Ctrl+C once
- **THEN** the same confirm overlay appears and the inbox session does not end solely because of that first press

#### Scenario: ESC dismisses overlay and continues
- **WHEN** the confirm overlay is visible and the user presses ESC
- **THEN** the overlay closes
- **AND** the prior wait UI resumes
- **AND** host copy keys `c` / `C` remain available when the resumed surface is host PIN wait

#### Scenario: Second Ctrl+C confirms exit
- **WHEN** the confirm overlay is visible and the user presses Ctrl+C again
- **THEN** the session ends and the process shuts down

### Requirement: Clean exit on intentional user cancel
When the process ends because the user confirmed cancel (second Ctrl+C on the confirm overlay, or equivalent confirmed interrupt leading to a canceled run context), the CLI SHALL treat that as a successful user-initiated exit: it MUST NOT print `erro: context canceled` (or equivalent operator-error framing of `context.Canceled`) on stderr, and MUST NOT exit with a non-zero status solely for that cancel. Confirmed cancel MAY be silent (no goodbye line).

#### Scenario: Confirmed Ctrl+C does not print context canceled error
- **WHEN** the user confirms exit with a second Ctrl+C on the overlay and the run ends only because the context was canceled
- **THEN** stderr does not contain `erro: context canceled`
- **AND** the process exit status is zero

#### Scenario: Real errors still report as erro
- **WHEN** the CLI fails for a reason other than intentional user cancel
- **THEN** the CLI still prints `erro:` with the failure and exits non-zero as today

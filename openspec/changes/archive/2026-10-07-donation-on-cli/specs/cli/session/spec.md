# Spec Delta

## MODIFIED Requirements

### Requirement: Interactive mode startup
The CLI SHALL start an interactive terminal prompt when launched without `-q` and without `-s`/`-c` that already select a role, presenting clear options to generate a share code (`Gerar um código`), join with an existing code (`Possuo um código`), or open settings (`Configurações`) when that option is offered. Host and join option labels MUST match Drop web/desktop exactly: `Gerar um código` and `Possuo um código`. When positional paths are present without `-s`/`-c`, the CLI SHALL still offer this interactive role selection and retain the paths for send after connect. When `-s` or `-c` is present without `-q`, the CLI SHALL skip the mode prompt per the interactive launch with role or path flags requirement.

#### Scenario: User selects Host
- **WHEN** user launches the CLI without role-selecting flags and selects `Gerar um código`
- **THEN** the CLI transitions to the host waiting screen and requests a session PIN

#### Scenario: User selects Join
- **WHEN** user launches the CLI without role-selecting flags and selects `Possuo um código`
- **THEN** the CLI prompts the user for a session PIN code

#### Scenario: User opens config menu
- **WHEN** user launches the CLI without flags and selects `Configurações` (or the equivalent settings entry when offered)
- **THEN** the CLI presents a settings form with the current persisted device name, download directory, a reset-stats option, and the project PIX key with a copy control
- **AND** the form does not include an auto-download control

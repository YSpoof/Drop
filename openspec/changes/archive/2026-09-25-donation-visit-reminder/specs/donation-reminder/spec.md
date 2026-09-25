# Spec Delta

## Purpose

Ask for a PIX contribution on a predictable visit interval, and only when the home screen is idle, without removing the donation block from Sobre o App.

## ADDED Requirements

### Requirement: Visit count persists per device

The system SHALL count one visit for each full app open on that device and SHALL persist the count across restarts. A client-side navigation that does not reload the document MUST NOT count as a new visit.

#### Scenario: Full open increments the count

- **WHEN** the user opens the app and the document loads
- **THEN** the stored visit count for that device increases by one

#### Scenario: In-app navigation does not increment

- **WHEN** the user moves between the home screen and a share session without reloading the document
- **THEN** the stored visit count stays unchanged

#### Scenario: Count survives a later open

- **WHEN** the user closes the app and opens it again on the same device
- **THEN** the visit count continues from the stored value

### Requirement: Donation reminder becomes due every 25 visits

The system SHALL mark a donation reminder due when the visit count reaches 25 and again every 25 full opens after the previous reminder is dismissed. While a reminder is already due, further opens MUST NOT queue a second reminder. Dismissing the reminder SHALL clear the due state and start the next 25-open interval from that dismissal.

#### Scenario: First reminder at 25 opens

- **WHEN** a full open makes the stored visit count 25 and no reminder is already due
- **THEN** the donation reminder becomes due

#### Scenario: Opens before the interval do not prompt

- **WHEN** the stored visit count is below 25, or fewer than 25 full opens have happened since the last dismissal
- **THEN** the donation reminder is not due

#### Scenario: A blocked interval does not stack

- **WHEN** a reminder is already due and the user opens the app again before dismissing it
- **THEN** the system still has one due reminder

#### Scenario: Dismissal starts the next interval

- **WHEN** the user dismisses a due reminder on visit N
- **THEN** the reminder is not due again until a later full open makes the visit count N + 25

### Requirement: Reminder appears only on a calm home screen

The system SHALL show the due donation reminder on the home screen only when that screen is calm. The home screen is calm when the user is on the home screen, the setup wizard is closed, the app-update dialog is closed, no other modal is open, and the app is not handing an incoming share off into a session. When the reminder is due and the home screen is not calm, the system MUST keep it due and MUST NOT show it over that other activity. The system SHALL show it as soon as the home screen later becomes calm, including a return from a share session during the same open.

#### Scenario: Calm home shows the reminder

- **WHEN** the reminder is due and the home screen is calm
- **THEN** the donation reminder modal is shown

#### Scenario: Share session defers the reminder

- **WHEN** the reminder becomes due during a full open that lands on a share session
- **THEN** the donation reminder modal is not shown and the reminder stays due

#### Scenario: Return home shows a deferred reminder

- **WHEN** a reminder is due and the user returns to a calm home screen in that same open
- **THEN** the donation reminder modal is shown

#### Scenario: Setup wizard defers the reminder

- **WHEN** the reminder is due and the setup wizard is open
- **THEN** the donation reminder modal is not shown until the wizard is closed and the home screen is calm

#### Scenario: Update dialog defers the reminder

- **WHEN** the reminder is due and the app-update dialog is open
- **THEN** the donation reminder modal is not shown until that dialog is closed and the home screen is calm

#### Scenario: Incoming share defers the reminder

- **WHEN** the reminder is due and the app is handing an incoming share off into a session
- **THEN** the donation reminder modal is not shown and the reminder stays due

### Requirement: Donation reminder modal offers the PIX key

The donation reminder modal SHALL tell the user that the app is free and that a PIX contribution helps keep the project going. It SHALL show the project's existing PIX key and SHALL copy that key to the clipboard when the user activates the key control. A successful copy SHALL be indicated on that control. A failed copy MUST leave the modal open and MUST NOT show the success indication. The modal SHALL provide a **Fechar** action. Dismissing the modal, including **Fechar**, the close control, or the backdrop, SHALL clear the due reminder. Copying the key MUST NOT clear the due reminder. The modal MUST NOT offer a control that permanently stops future reminders.

#### Scenario: Copy succeeds

- **WHEN** the user activates the PIX key control and the clipboard accepts the key
- **THEN** the clipboard contains the project's PIX key and the control shows success

#### Scenario: Copy fails

- **WHEN** the user activates the PIX key control and the clipboard rejects the key
- **THEN** the modal stays open and the control does not show success

#### Scenario: Fechar clears the reminder

- **WHEN** the user activates **Fechar**
- **THEN** the modal closes and the reminder is no longer due

#### Scenario: Closing without Fechar still clears the reminder

- **WHEN** the user dismisses the modal with the close control or the backdrop
- **THEN** the modal closes and the reminder is no longer due

#### Scenario: Copy does not dismiss

- **WHEN** the user copies the PIX key and does not dismiss the modal
- **THEN** the reminder stays due

#### Scenario: Leaving without dismissing keeps it due

- **WHEN** the reminder modal is shown and the user closes the app without dismissing it
- **THEN** the reminder is still due on a later calm home screen

### Requirement: Sobre keeps its donation block

The automatic reminder MUST NOT remove or replace the donation block in **Sobre o App**. Opening **Sobre o App** SHALL still show the existing PIX key and its copy control.

#### Scenario: Sobre still offers the PIX key

- **WHEN** the user opens **Sobre o App**
- **THEN** the modal still shows the PIX key and a control that copies it

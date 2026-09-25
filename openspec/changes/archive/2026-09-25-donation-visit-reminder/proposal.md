# Proposal

## Why

The PIX key lives only inside **Sobre o App**, so someone who never opens that modal never sees a way to contribute. A reminder on a calm home screen asks at a predictable interval without covering an active transfer.

## What Changes

- Count one visit per full app open and persist the count on this device.
- Show a new donation modal when the count reaches 25, 50, 75, and so on.
- If that open is not a calm home screen, keep the prompt due and show it the first time home is idle, including a return from `/share/` in the same open.
- The modal explains that Drop is free and that a PIX helps keep the project going, offers the existing PIX key with tap-to-copy, and closes with **Fechar**. Closing clears the prompt. The next one is 25 opens later. There is no "never again".
- **Sobre o App** keeps its existing donation block. This modal is only the automatic reminder.

Assumption: the reminder copy is the short pitch above, not a repeat of the **Sobre** heading "Contribua com o projeto".

## Capabilities

### New Capabilities

- `donation-reminder`: visit counting and the automatic donation modal on a calm home screen.

### Modified Capabilities

- None. The project has no existing specs.

## Impact

- New modal component, a visit counter in `localForage`, and a flag on the UI store so the root layout can open the modal the same way as the other lazy layout modals.
- Home-screen gating must see the setup wizard, the update dialog, the Android share handoff, and an in-progress share session.
- **Sobre o App**, the PIX key in site data, and the manual path from the gear menu stay as they are.
- The README future-idea bullet for a donation reminder becomes obsolete.

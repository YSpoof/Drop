# Tasks

## 1. Visit counter

- [x] 1.1 Add `DONATION_REMINDER_INTERVAL = 25` to `src/lib/consts.ts` and verify the export is the number 25
- [x] 1.2 Add a `localForage` helper that increments `visitCount`, reads `donationReminderAnchor` (default 0), and reports due when `visitCount >= donationReminderAnchor + DONATION_REMINDER_INTERVAL`. Verify the helper is the only writer of those two keys
- [x] 1.3 Call that helper once from `src/routes/+layout.svelte` `onMount` and store the result on `uiStore.donationReminderDue`. Verify a client navigation between `/` and `/share/` does not call it again

## 2. Calm home gate

- [x] 2.1 Mirror the home page possess-code modal on `uiStore.possessCodeOpen`, and add `shareHandoffPending` starting true. In the home page `onMount`, clear `shareHandoffPending` only when `hasSharedRecords()` does not start a handoff. Verify opening **Possuo um código** sets the store flag, and an incoming share leaves the flag set until a later home mount finds no queued share
- [x] 2.2 Add a root-layout effect that sets `uiStore.donationReminderOpen` only when the reminder is due, the pathname is `/`, and the setup wizard, update dialog, Sobre, stats, settings, share-notify, possess-code, and share handoff are all clear. Verify the effect does not treat `donationReminderOpen` as a busy modal

## 3. Donation reminder modal

- [x] 3.1 Add `DonationReminderModal.svelte` and register it in `layoutModals`. Title `Gostou do Drop?`, body that the app is free and a PIX helps keep the project going, the existing PIX key with the same copy success and failure behavior as Sobre, and **Fechar**. Verify the gear menu still opens Sobre with its PIX block unchanged
- [x] 3.2 Dismiss by writing `donationReminderAnchor` to the current `visitCount` and clearing the due flag only when `donationReminderOpen` is still true. **Fechar**, the close control, and the backdrop dismiss. A programmatic hide must not. Verify hiding the modal because the home screen stopped being calm leaves the reminder due, and dismissing it keeps the modal closed until 25 further full opens
- [x] 3.3 Remove the README future-idea bullet "Modal de reminder para doação" and verify that bullet is gone

## 4. Integration

- [x] 4.1 On a calm home screen at visit 25, verify the reminder appears, copying the key does not dismiss it, and **Fechar** does. Verify it stays hidden on `/share/`, over the setup wizard, over the update dialog, and during an Android share handoff, then appears when the home screen is calm again without an extra 25 opens

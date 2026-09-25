# Design

## Context

See proposal.md for why. Behavior contract is `specs/donation-reminder/spec.md`.

The app is a client-only SvelteKit SPA (`ssr = false`). The root layout stays mounted across navigations between `/` and `/share/`. `localForage` instance `drop` already persists device state such as `setupWizardViewed`. Modals in `layoutModals` lazy-load when a `uiStore` flag is true and render through `GenericModal`. The PIX key and the copy button live in `InfoModal`. `PossessCodeModal` is local state on the home page. An incoming Android share is detected in the home page `onMount` via `hasSharedRecords()`, then either opens the notify modal or navigates to `/share/`, where `consumeSharedRecords()` runs. The update dialog is `updated.current` in the root layout, not a `uiStore` flag.

## Goals / Non-Goals

**Goals:**

- Count one visit per document load, persist it, and derive a single due reminder from that count.
- Open the new modal only while the home screen is calm, and hide it without consuming the reminder when the screen stops being calm.
- Reuse `GenericModal`, `layoutModals`, `uiStore`, and the existing PIX key.

**Non-Goals:**

- A permanent opt-out, a server-side counter, or any donation method besides the existing PIX key.
- Editing the **Sobre** donation block or extracting a shared PIX component.
- Cross-tab locking. Two tabs can each increment once.

## Decisions

### Persist a count and a dismissal anchor

Store two numbers in `localForage`:

- `visitCount` — full opens so far
- `donationReminderAnchor` — `visitCount` at the last dismissal, default `0`

The reminder is due when `visitCount >= donationReminderAnchor + 25`. Dismissal sets the anchor to the current `visitCount`. One inequality is one pending reminder, so extra opens while it is already due do not queue another. The interval `25` lives next to the other constants in `src/lib/consts.ts`.

Alternative: a boolean `donationReminderDue` plus the count. That splits one fact across two keys and can drift. The anchor keeps the next interval tied to the dismissal the spec requires.

Alternative: strict multiples (25, 50, 75) even after a late dismissal. A reminder deferred until visit 30 would then return at 50, which is fewer than 25 opens after the user actually saw it. The spec starts the next interval at dismissal.

### Increment once from the root layout mount

`src/routes/+layout.svelte` `onMount` calls a small helper (new module under `src/lib/utils/`, not `prefs.ts`) that reads both keys, adds one to `visitCount`, writes it, and returns whether the reminder is due. The layout then sets `uiStore.donationReminderDue`.

Module init of `uiStore` is the wrong place. Importing the store from a test or a child would count a visit. An `$effect` is the wrong place because it re-runs. `onMount` on the root layout runs once per document load and does not re-run on client navigation.

### Calm is a layout effect over existing flags

`uiStore.donationReminderOpen` is separate from `donationReminderDue`. A root-layout effect sets:

```
open = due
  AND pathname is /
  AND setup wizard, update dialog, Sobre, stats, settings,
      share-notify, and possess-code are all closed
  AND share handoff is not pending
```

The modal's own open flag is not part of that condition.

`PossessCodeModal` is page-local today, so the home page must mirror it on `uiStore.possessCodeOpen`. Without that, the reminder can cover "Possuo um código".

`shareHandoffPending` starts `true`. The home page `onMount` already calls `hasSharedRecords()`. After that check it clears the flag only when it did not start a handoff. If it did (`openGenerateGate`), it leaves the flag set so the reminder cannot flash in the tick before `goto('/share/')`. The home page mounts again on the way back, runs the check, finds no queued share (the share page consumes the records), and clears the flag.

### Hiding is not dismissal

`GenericModal` reports every dialog `close`, including a parent setting `open` to false. The reminder modal treats that callback as a dismissal only when `donationReminderOpen` is still true. Paths:

- **Fechar**, the close control, or the backdrop: the flag is still true, so the handler writes the anchor, clears `donationReminderDue`, and closes.
- **Effect hides because the screen is no longer calm**: the layout sets `donationReminderOpen` false first. The dialog then closes, the callback sees the flag already false, and the anchor stays. The reminder remains due.

Closing the app without a dismissal leaves the anchor unchanged, so the next calm home screen shows it again.

### New modal, copied PIX control

Add `DonationReminderModal.svelte` and register it in `layoutModals` the same way as `InfoModal`. Title `Gostou do Drop?`. Body: the app is free and a PIX helps keep the project going. The key button copies `siteData.donationPixKey` with the same success and failure behavior as **Sobre** (success state on the button, errors ignored, modal stays open). **Fechar** is the only action. No opt-out control.

Duplicating the short copy button keeps this change out of `InfoModal`. A shared component can wait until a third caller exists.

## Risks / Trade-offs

- [Two tabs both read the same count and write `count + 1`] → Accept it. The reminder can arrive one open early or late. A lock is more machinery than the feature is worth.
- [`shareHandoffPending` stuck true] → Only the home page clears it, and only when it is not handing off. A handoff navigates away; the next home mount runs the check again. Do not clear the flag in `finally` before `goto` settles.
- [Update dialog appears after the reminder is already open] → `updated.current` is part of the calm effect, so the reminder hides without dismissal and returns when the update dialog closes.
- [Users who mostly arrive through share links wait longer than 25 calendar days] → The interval is opens, not days. The reminder waits for a calm home screen and does not interrupt the session. That is the requested trade-off.
- [Existing installs start at zero] → No backfill. The first reminder is the 25th open after this ships.

## Migration Plan

Ship the client change. New keys appear on the next open. Rollback is removing the modal and the increment. Leftover `visitCount` and `donationReminderAnchor` keys are unused and safe to leave in `localForage`.

Remove the README future-idea bullet "Modal de reminder para doação" in the same change. It describes this work.

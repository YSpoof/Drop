import { DONATION_REMINDER_INTERVAL } from "#lib/consts.js";
import { localForage } from "#lib/utils/localForage.js";

const VISIT_COUNT_KEY = "visitCount";
const ANCHOR_KEY = "donationReminderAnchor";

function storedCount(value: number | null): number {
  return value ?? 0;
}

let recording: Promise<void> | null = null;

async function incrementVisit(): Promise<void> {
  const visitCount = storedCount(await localForage.getItem<number>(VISIT_COUNT_KEY)) + 1;
  await localForage.setItem(VISIT_COUNT_KEY, visitCount);
}

async function donationReminderIsDue(): Promise<boolean> {
  const visitCount = await readVisitCount();
  const anchor = storedCount(await localForage.getItem<number>(ANCHOR_KEY));
  return visitCount >= anchor + DONATION_REMINDER_INTERVAL;
}

export async function recordAppVisit(): Promise<boolean> {
  recording ??= incrementVisit();
  return recording.then(() => donationReminderIsDue());
}

export async function readVisitCount(): Promise<number> {
  return storedCount(await localForage.getItem<number>(VISIT_COUNT_KEY));
}

export async function dismissDonationReminder(visitCount: number): Promise<void> {
  await localForage.setItem(ANCHOR_KEY, visitCount);
}

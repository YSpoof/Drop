/** Digit count for the share PIN (OTP UI + signaling). */
export const SHARE_CODE_DIGITS = 4;

/** Exclusive upper bound for `randomInt` PIN allocation (`10 ** SHARE_CODE_DIGITS`). */
export const SHARE_CODE_RANGE = 5 ** SHARE_CODE_DIGITS;

/** Guest “Possuo um código”: retry join-code until this elapses, then “Código inválido”. */
export const CODE_JOIN_WAIT_MS = 30_000;

/** Delay between join-code retries while the host may still be announcing. */
export const CODE_JOIN_RETRY_MS = 2_000;

/** Time to wait for the host to pair us. */
export const PAIRING_TIMEOUT_MS = 15_000;

/** Time to wait for the host to connect after we've connected. */
export const CODE_JOIN_CONNECTED_CLOSE_MS = 3_000;

/** Time to wait for the host to close the connection after we've connected. */
export const CODE_JOIN_CLOSE_MS = 300;

/** Full app opens between donation reminders. */
export const DONATION_REMINDER_INTERVAL = 25;

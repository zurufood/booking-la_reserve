export const MAX_SEATS = 24;

const depositFromEnv = Number(import.meta.env.VITE_DEPOSIT_PER_SEAT);

export const DEPOSIT_PER_SEAT =
  Number.isFinite(depositFromEnv) && depositFromEnv >= 0 ? depositFromEnv : 10;

export const PAYMENT_URL = (import.meta.env.VITE_DEPOSIT_PAYMENT_URL || '').trim();

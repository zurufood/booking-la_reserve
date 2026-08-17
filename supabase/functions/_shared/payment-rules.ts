export const PRICE_PER_SEAT_CENTS = 2800;
export const PAYMENT_HOLD_MINUTES = 45;
export const CHECKOUT_URL_MINUTES = 15;

export function calculatePaymentAmountCents(seats: number) {
  if (!Number.isInteger(seats) || seats < 1 || seats > 24) {
    throw new Error('Nombre de places invalide.');
  }
  return seats * PRICE_PER_SEAT_CENTS;
}

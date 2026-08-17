import { calculatePaymentAmountCents } from './payment-rules.ts';
import { extractAuthorizedCheckout } from './helloasso.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Attendu ${expected}, reçu ${actual}`);
}

Deno.test('calcule 28 euros par place côté serveur', () => {
  assertEquals(calculatePaymentAmountCents(1), 2800);
  assertEquals(calculatePaymentAmountCents(2), 5600);
  assertEquals(calculatePaymentAmountCents(5), 14000);
});

Deno.test('retrouve uniquement un paiement HelloAsso autorisé', () => {
  const checkout = {
    id: 12,
    order: {
      id: 34,
      payments: [{ id: 56, amount: 5600, state: 'Authorized', paymentMeans: 'Card' }],
    },
  };
  const result = extractAuthorizedCheckout(checkout);
  assertEquals(result?.orderId, 34);
  assertEquals(result?.paymentId, 56);
  assertEquals(result?.amountCents, 5600);
  assertEquals(extractAuthorizedCheckout({ id: 12 }), null);
});

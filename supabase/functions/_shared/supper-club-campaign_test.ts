import { assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert';
import { buildSupperClubReminderEmail } from './reservation-email.ts';

Deno.test('la version payée ne contient aucune mention du paiement', () => {
  const email = buildSupperClubReminderEmail({ firstName: 'Camille' });
  assertEquals(email.subject, 'À demain pour notre premier Supper Club !');
  assertStringIncludes(email.text, 'Cher Camille,');
  assertFalse(email.text.includes('lien de paiement'));
  assertFalse(email.html.includes('Régler ma réservation'));
  assertStringIncludes(email.html, '/zuru-logo-email.png');
  assertStringIncludes(email.html, 'alt="Zuru Zuru Supper Club"');
});

Deno.test('la version non payée contient uniquement son lien individuel', () => {
  const paymentUrl = 'https://lareserve.zuruzuru.fr/reglement?token=token-unique';
  const email = buildSupperClubReminderEmail({ firstName: 'Alex', paymentUrl });
  assertStringIncludes(email.text, 'Voici le lien de paiement pour votre réservation :');
  assertStringIncludes(email.text, paymentUrl);
  assertStringIncludes(email.html, paymentUrl);
  assertStringIncludes(email.html, 'Régler ma réservation');
});

Deno.test('un email test est clairement identifié', () => {
  const email = buildSupperClubReminderEmail({
    firstName: 'Admin',
    paymentUrl: 'https://example.test/non-fonctionnel',
    testLabel: 'VERSION INVITÉ NON PAYÉ – LIEN NON FONCTIONNEL',
  });
  assertStringIncludes(email.text, '[EMAIL TEST – VERSION INVITÉ NON PAYÉ – LIEN NON FONCTIONNEL]');
  assertStringIncludes(email.html, 'EMAIL TEST');
});

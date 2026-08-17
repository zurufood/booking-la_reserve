import { assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert';
import { buildReservationFeedbackEmail } from './reservation-email.ts';

const reviewUrl = 'https://share.google/xPCpYFFae7GQdypwS';
const reservation = {
  firstName: 'Camille',
  lastName: 'Test',
  email: 'zuruzurufood@gmail.com',
  phone: 'Non applicable',
  seats: 1,
  serviceDate: '2026-07-16',
};

Deno.test("l'email d'avis contient le lien Google dans les versions texte et HTML", () => {
  const email = buildReservationFeedbackEmail(reservation, reviewUrl);

  assertEquals(email.subject, 'Votre avis sur le repas Zuru Zuru ?');
  assertStringIncludes(email.text, reviewUrl);
  assertStringIncludes(email.html, reviewUrl);
  assertStringIncludes(email.html, 'Laisser un avis Google');
  assertStringIncludes(email.html, 'src="https://lareserve.zuruzuru.fr/zuru-logo-email.png"');
  assertStringIncludes(email.html, 'alt="Zuru Zuru"');
  assertFalse(email.html.includes('>Zuru Zuru Supper Club</p>'));
});

Deno.test("l'email d'avis test est clairement identifié", () => {
  const email = buildReservationFeedbackEmail(reservation, reviewUrl, {
    testLabel: 'AUCUN PARTICIPANT CONTACTÉ',
  });

  assertEquals(email.subject, '[TEST] Votre avis sur le repas Zuru Zuru ?');
  assertStringIncludes(email.text, '[EMAIL TEST – AUCUN PARTICIPANT CONTACTÉ]');
  assertStringIncludes(email.html, 'EMAIL TEST – AUCUN PARTICIPANT CONTACTÉ');
});

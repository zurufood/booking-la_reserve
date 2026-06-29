const RESEND_API_URL = 'https://api.resend.com/emails';
const EVENT_DATETIME = '20:00 - 23:00 jeudi 16 juillet 2026';
const EVENT_ADDRESS = 'La Réserve - Darwin, 87 Quai des Queyries, 33100 Bordeaux';

const menuSections = [
  {
    title: 'Amuse-bouche',
    items: ['Amuse-bouche de saison', 'Bouchée signature'],
  },
  {
    title: 'Entrées',
    items: ['Entrée végétale', 'Entrée iodée'],
  },
  {
    title: 'Plat',
    items: ['Plat principal du jeudi'],
  },
  {
    title: 'Dessert',
    items: ['Dessert de saison'],
  },
];

type ReservationConfirmation = {
  email: string;
  phone: string;
  seats: number;
  depositPerSeat: number;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function buildTextEmail(reservation: ReservationConfirmation) {
  const depositTotal = reservation.seats * reservation.depositPerSeat;
  const menu = menuSections
    .map((section) => {
      const items = section.items.map((item) => `- ${item}`).join('\n');
      return `${section.title}\n${items}`;
    })
    .join('\n\n');

  return [
    'Paiement reçu. Merci pour votre confiance !',
    '',
    'Récapitulatif',
    `Places : ${reservation.seats}`,
    `Acompte réglé : ${formatMoney(depositTotal)}`,
    `Date et horaire : ${EVENT_DATETIME}`,
    `Adresse : ${EVENT_ADDRESS}`,
    `Telephone : ${reservation.phone}`,
    '',
    'Menu',
    menu,
    '',
    'À très vite,',
    'La Réserve - Darwin x Zuru Zuru',
  ].join('\n');
}

function buildHtmlEmail(reservation: ReservationConfirmation) {
  const depositTotal = reservation.seats * reservation.depositPerSeat;
  const menuHtml = menuSections
    .map(
      (section) => `
        <section style="margin:0 0 18px;">
          <h3 style="margin:0 0 8px;color:#17202a;font-size:16px;">${escapeHtml(section.title)}</h3>
          <ul style="margin:0;padding-left:20px;color:#465163;">
            ${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </section>
      `,
    )
    .join('');

  return `
    <!doctype html>
    <html lang="fr">
      <body style="margin:0;padding:0;background:#f4f5f3;font-family:Arial,sans-serif;color:#17202a;">
        <div style="max-width:620px;margin:0 auto;padding:28px 18px;">
          <div style="background:#ffffff;border:1px solid #dce2da;border-radius:8px;padding:24px;">
            <p style="margin:0 0 8px;color:#0f766e;font-size:13px;font-weight:700;text-transform:uppercase;">La Réserve - Darwin</p>
            <h1 style="margin:0 0 12px;color:#111827;font-size:28px;line-height:1.15;">Paiement reçu. Merci pour votre confiance !</h1>
            <p style="margin:0 0 22px;color:#465163;">Votre réservation est confirmée.</p>

            <div style="margin:0 0 24px;padding:16px;border:1px solid #d7dee8;border-radius:8px;background:#f8fafc;">
              <p style="margin:0 0 8px;"><strong>Places :</strong> ${reservation.seats}</p>
              <p style="margin:0 0 8px;"><strong>Acompte réglé :</strong> ${formatMoney(depositTotal)}</p>
              <p style="margin:0 0 8px;"><strong>Date et horaire :</strong> ${EVENT_DATETIME}</p>
              <p style="margin:0 0 8px;"><strong>Adresse :</strong> ${EVENT_ADDRESS}</p>
              <p style="margin:0;"><strong>Telephone :</strong> ${escapeHtml(reservation.phone)}</p>
            </div>

            <h2 style="margin:0 0 14px;color:#111827;font-size:20px;">Menu</h2>
            ${menuHtml}

            <p style="margin:24px 0 0;color:#465163;">À très vite,<br>La Réserve - Darwin x Zuru Zuru</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

export async function sendReservationConfirmationEmail(reservation: ReservationConfirmation) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('RESERVATION_EMAIL_FROM');
  const replyTo = Deno.env.get('RESERVATION_EMAIL_REPLY_TO');

  if (!apiKey || !from) {
    console.warn('Reservation confirmation email skipped: missing RESEND_API_KEY or RESERVATION_EMAIL_FROM.');
    return { sent: false, reason: 'missing_email_config' };
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [reservation.email],
      reply_to: replyTo || undefined,
      subject: 'Votre réservation La Réserve - Darwin',
      text: buildTextEmail(reservation),
      html: buildHtmlEmail(reservation),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Email confirmation impossible: ${errorText || response.statusText}`);
  }

  return { sent: true };
}

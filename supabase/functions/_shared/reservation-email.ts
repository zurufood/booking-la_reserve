const RESEND_API_URL = 'https://api.resend.com/emails';
const EVENT_ADDRESS = 'La Réserve - Darwin, 87 Quai des Queyries, 33100 Bordeaux';
const ADMIN_RESERVATION_EMAIL = 'zurufood@gmail.com';

const menuSections = [
  '2x Amuse-bouche',
  '2x Entrées',
  '1 Plat',
  '1 Dessert',
];

export type ReservationEmailData = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  seats: number;
  serviceDate: string;
};

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Secret manquant: ${name}`);
  }
  return value;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatLongDate(date: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${date}T12:00:00`));
}

function getFullName(reservation: ReservationEmailData) {
  return `${reservation.firstName} ${reservation.lastName}`.trim();
}

function buildSummaryText(reservation: ReservationEmailData) {
  return [
    `Nom : ${getFullName(reservation)}`,
    `Places : ${reservation.seats}`,
    `Date et horaire : ${formatLongDate(reservation.serviceDate)}, 20:30 - 23:00`,
    `Adresse : ${EVENT_ADDRESS}`,
    `Téléphone : ${reservation.phone}`,
  ].join('\n');
}

function buildMenuText() {
  return menuSections.join('\n');
}

function buildSummaryHtml(reservation: ReservationEmailData) {
  return `
    <div style="margin:0 0 24px;padding:16px;border:1px solid #d7dee8;border-radius:8px;background:#f8fafc;">
      <p style="margin:0 0 8px;"><strong>Places :</strong> ${reservation.seats}</p>
      <p style="margin:0 0 8px;"><strong>Nom :</strong> ${escapeHtml(getFullName(reservation))}</p>
      <p style="margin:0 0 8px;"><strong>Date et horaire :</strong> ${formatLongDate(reservation.serviceDate)}, 20:30 - 23:00</p>
      <p style="margin:0 0 8px;"><strong>Adresse :</strong> ${escapeHtml(EVENT_ADDRESS)}</p>
      <p style="margin:0;"><strong>Téléphone :</strong> ${escapeHtml(reservation.phone)}</p>
    </div>
  `;
}

function buildMenuHtml() {
  return menuSections
    .map((section) => `<li style="margin:0 0 8px;">${escapeHtml(section)}</li>`)
    .join('');
}

function wrapHtml(title: string, lead: string, body: string) {
  return `
    <!doctype html>
    <html lang="fr">
      <body style="margin:0;padding:0;background:#f4f5f3;font-family:Arial,sans-serif;color:#17202a;">
        <div style="max-width:620px;margin:0 auto;padding:28px 18px;">
          <div style="background:#ffffff;border:1px solid #dce2da;border-radius:8px;padding:24px;">
            <p style="margin:0 0 8px;color:#d817a8;font-size:13px;font-weight:700;text-transform:uppercase;">Zuru Zuru Supper Club</p>
            <h1 style="margin:0 0 12px;color:#111827;font-size:28px;line-height:1.15;">${escapeHtml(title)}</h1>
            <p style="margin:0 0 22px;color:#465163;">${escapeHtml(lead)}</p>
            ${body}
            <p style="margin:24px 0 0;color:#465163;">À très vite,<br>La Réserve - Darwin x Zuru Zuru</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

async function sendEmail({
  to,
  subject,
  text,
  html,
  replyTo,
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}) {
  const apiKey = requireEnv('RESEND_API_KEY');
  const from = requireEnv('RESERVATION_EMAIL_FROM');
  const defaultReplyTo = Deno.env.get('RESERVATION_EMAIL_REPLY_TO');

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: replyTo || defaultReplyTo || undefined,
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Email impossible: ${errorText || response.statusText}`);
  }
}

export async function sendReservationValidationEmail(
  reservation: ReservationEmailData,
  validationUrl: string,
  expiresAt: string,
) {
  const expiresAtLabel = new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(expiresAt));

  const text = [
    'Validez votre inscription',
    '',
    'Merci pour votre inscription. Pour confirmer votre place, cliquez sur ce lien :',
    validationUrl,
    '',
    `Ce lien est valable jusqu’au ${expiresAtLabel}.`,
    '',
    'Récapitulatif',
    buildSummaryText(reservation),
    '',
    'Menu',
    buildMenuText(),
  ].join('\n');

  const html = wrapHtml(
    'Validez votre inscription',
    `Votre place est réservée temporairement. Le lien est valable jusqu’au ${expiresAtLabel}.`,
    `
      <p style="margin:0 0 22px;">
        <a href="${escapeHtml(validationUrl)}" style="display:inline-block;padding:12px 16px;border-radius:7px;background:#d817a8;color:#ffffff;font-weight:700;text-decoration:none;">Valider mon inscription</a>
      </p>
      ${buildSummaryHtml(reservation)}
      <h2 style="margin:0 0 14px;color:#111827;font-size:20px;">Menu</h2>
      <ul style="margin:0;padding-left:20px;color:#465163;">${buildMenuHtml()}</ul>
    `,
  );

  await sendEmail({
    to: reservation.email,
    subject: 'Validez votre inscription Zuru Zuru',
    text,
    html,
  });
}

export async function sendReservationConfirmedEmail(
  reservation: ReservationEmailData,
  cancellationUrl: string,
) {
  const text = [
    'Inscription confirmée',
    '',
    'Votre inscription est confirmée. Merci !',
    '',
    'Récapitulatif',
    buildSummaryText(reservation),
    '',
    'Menu',
    buildMenuText(),
    '',
    'Annulation',
    'Si vous ne pouvez plus venir, annulez votre réservation ici :',
    cancellationUrl,
  ].join('\n');

  const html = wrapHtml(
    'Inscription confirmée',
    'Votre inscription est confirmée. Merci !',
    `
      ${buildSummaryHtml(reservation)}
      <h2 style="margin:0 0 14px;color:#111827;font-size:20px;">Menu</h2>
      <ul style="margin:0;padding-left:20px;color:#465163;">${buildMenuHtml()}</ul>
      <p style="margin:24px 0 0;">
        <a href="${escapeHtml(cancellationUrl)}" style="display:inline-block;padding:12px 16px;border-radius:7px;background:#111827;color:#ffffff;font-weight:700;text-decoration:none;">Annuler ma réservation</a>
      </p>
    `,
  );

  await sendEmail({
    to: reservation.email,
    subject: 'Votre inscription Zuru Zuru est confirmée',
    text,
    html,
  });
}

export async function sendAdminReservationConfirmedEmail(reservation: ReservationEmailData) {
  const fullName = getFullName(reservation);

  const text = [
    'Nouvelle inscription confirmée',
    '',
    `Nom : ${fullName}`,
    `Email : ${reservation.email}`,
    `Téléphone : ${reservation.phone}`,
    `Places : ${reservation.seats}`,
    `Date et horaire : ${formatLongDate(reservation.serviceDate)}, 20:30 - 23:00`,
  ].join('\n');

  const html = wrapHtml(
    'Nouvelle inscription confirmée',
    'Une inscription vient d’être confirmée.',
    `
      <div style="margin:0 0 24px;padding:16px;border:1px solid #d7dee8;border-radius:8px;background:#f8fafc;">
        <p style="margin:0 0 8px;"><strong>Nom :</strong> ${escapeHtml(fullName)}</p>
        <p style="margin:0 0 8px;"><strong>Email :</strong> <a href="mailto:${escapeHtml(
          reservation.email,
        )}" style="color:#d817a8;">${escapeHtml(reservation.email)}</a></p>
        <p style="margin:0 0 8px;"><strong>Téléphone :</strong> <a href="tel:${escapeHtml(
          reservation.phone,
        )}" style="color:#d817a8;">${escapeHtml(reservation.phone)}</a></p>
        <p style="margin:0 0 8px;"><strong>Places :</strong> ${reservation.seats}</p>
        <p style="margin:0;"><strong>Date et horaire :</strong> ${formatLongDate(
          reservation.serviceDate,
        )}, 20:30 - 23:00</p>
      </div>
    `,
  );

  await sendEmail({
    to: ADMIN_RESERVATION_EMAIL,
    subject: 'Nouvelle inscription confirmée Zuru Zuru',
    text,
    html,
    replyTo: reservation.email,
  });
}

export async function sendReservationSummaryEmail(
  reservation: ReservationEmailData,
  {
    actionUrl,
    actionLabel,
    actionText,
  }: {
    actionUrl?: string;
    actionLabel?: string;
    actionText?: string;
  } = {},
) {
  const actionTextLines = actionUrl
    ? ['', actionText || 'Vous pouvez gérer votre réservation ici :', actionUrl]
    : [];

  const text = [
    'Récapitulatif de votre réservation',
    '',
    'Une réservation existe déjà avec cette adresse email. Voici le récapitulatif :',
    '',
    'Récapitulatif',
    buildSummaryText(reservation),
    '',
    'Menu',
    buildMenuText(),
    ...actionTextLines,
  ].join('\n');

  const actionHtml =
    actionUrl && actionLabel
      ? `
        <p style="margin:24px 0 10px;color:#465163;">${escapeHtml(
          actionText || 'Vous pouvez gérer votre réservation ici :',
        )}</p>
        <p style="margin:0 0 22px;">
          <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 16px;border-radius:7px;background:#111827;color:#ffffff;font-weight:700;text-decoration:none;">${escapeHtml(
            actionLabel,
          )}</a>
        </p>
      `
      : '';

  const html = wrapHtml(
    'Récapitulatif de votre réservation',
    'Une réservation existe déjà avec cette adresse email. Voici le récapitulatif.',
    `
      ${buildSummaryHtml(reservation)}
      <h2 style="margin:0 0 14px;color:#111827;font-size:20px;">Menu</h2>
      <ul style="margin:0;padding-left:20px;color:#465163;">${buildMenuHtml()}</ul>
      ${actionHtml}
    `,
  );

  await sendEmail({
    to: reservation.email,
    subject: 'Récapitulatif de votre réservation Zuru Zuru',
    text,
    html,
  });
}

export async function sendReservationFeedbackEmail(
  reservation: ReservationEmailData,
  googleReviewUrl: string,
) {
  const firstName = reservation.firstName.trim();
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
  const reviewUrl = googleReviewUrl.trim();

  const text = [
    greeting,
    '',
    `Merci encore pour votre présence à notre table du ${formatLongDate(reservation.serviceDate)}.`,
    '',
    "On aimerait beaucoup savoir ce que vous avez pensé du repas. Vous pouvez répondre directement à cet email, on lit tout.",
    '',
    "Et si le moment vous a plu, un avis Google nous aiderait énormément :",
    reviewUrl,
    '',
    'Merci encore pour votre présence.',
  ].join('\n');

  const html = wrapHtml(
    'Alors, ce repas ?',
    `Merci encore pour votre présence à notre table du ${formatLongDate(reservation.serviceDate)}.`,
    `
      <p style="margin:0 0 16px;color:#465163;">
        On aimerait beaucoup savoir ce que vous avez pensé du repas. Vous pouvez répondre directement à cet email, on lit tout.
      </p>
      <p style="margin:0 0 22px;color:#465163;">
        Et si le moment vous a plu, un avis Google nous aiderait énormément.
      </p>
      <p style="margin:0 0 22px;">
        <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;padding:12px 16px;border-radius:7px;background:#d817a8;color:#ffffff;font-weight:700;text-decoration:none;">Laisser un avis Google</a>
      </p>
      ${buildSummaryHtml(reservation)}
    `,
  );

  await sendEmail({
    to: reservation.email,
    subject: 'Votre avis sur le repas Zuru Zuru ?',
    text,
    html,
  });
}

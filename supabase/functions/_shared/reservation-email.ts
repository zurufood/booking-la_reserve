const RESEND_API_URL = 'https://api.resend.com/emails';
const EVENT_ADDRESS = 'La Réserve - Darwin, 87 Quai des Queyries, 33100 Bordeaux';
const ADMIN_RESERVATION_EMAIL = 'zuruzurufood@gmail.com';

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

export type PaymentReservationEmailData = ReservationEmailData & {
  paymentAmountCents?: number | null;
  helloAssoPaymentId?: number | string | null;
};

function formatMoneyCents(amountCents?: number | null) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(
    Number(amountCents || 0) / 100,
  );
}

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

function wrapHtml(
  title: string,
  lead: string,
  body: string,
  { headerLogoUrl }: { headerLogoUrl?: string } = {},
) {
  const header = headerLogoUrl
    ? `<div style="margin:0 0 24px;text-align:center;"><img src="${escapeHtml(headerLogoUrl)}" width="300" alt="Zuru Zuru" style="display:inline-block;width:100%;max-width:300px;height:auto;border:0;" /></div>`
    : '<p style="margin:0 0 8px;color:#d817a8;font-size:13px;font-weight:700;text-transform:uppercase;">Zuru Zuru Supper Club</p>';

  return `
    <!doctype html>
    <html lang="fr">
      <body style="margin:0;padding:0;background:#f4f5f3;font-family:Arial,sans-serif;color:#17202a;">
        <div style="max-width:620px;margin:0 auto;padding:28px 18px;">
          <div style="background:#ffffff;border:1px solid #dce2da;border-radius:8px;padding:24px;">
            ${header}
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

  const result = await response.json().catch(() => ({}));
  if (!result.id) throw new Error('Email accepté sans identifiant de suivi Resend.');
  return { id: String(result.id) };
}

export function buildSupperClubReminderEmail({
  firstName,
  paymentUrl,
  testLabel,
  logoUrl = 'https://lareserve.zuruzuru.fr/zuru-logo-email.png',
}: {
  firstName: string;
  paymentUrl?: string;
  testLabel?: string;
  logoUrl?: string;
}) {
  const subject = 'À demain pour notre premier Supper Club !';
  const greeting = `Cher ${firstName || 'invité'},`;
  const paymentText = paymentUrl
    ? ['', 'Voici le lien de paiement pour votre réservation :', paymentUrl]
    : [];
  const testText = testLabel ? [`[EMAIL TEST – ${testLabel}]`, ''] : [];
  const text = [
    ...testText,
    greeting,
    '',
    'Nous sommes très heureux de vous accueillir demain pour la toute première édition de notre Supper Club à La Réserve, au sein de Darwin.',
    '',
    "Notre envie est simple : réunir des bons vivants autour d'une grande table, partager un repas cuisiné avec passion à partir d'ingrédients de saison, locaux et soigneusement cultivés, dans un esprit de découverte, de générosité et de convivialité.",
    '',
    'Nous avons hâte de partager cette soirée avec vous !',
    '',
    'Voici quelques informations pratiques :',
    '- À partir de 18h30 : apéritif devant La Réserve',
    '- 20h30 : dîner en 4 services',
    '',
    'Adresse',
    'Darwin – La Réserve',
    '87 Quai des Queyries',
    '33100 Bordeaux',
    ...paymentText,
    '',
    'À demain,',
    '',
    'Jérémie et Christophe',
  ].join('\n');

  const testBanner = testLabel
    ? `<div style="margin:0 0 20px;padding:12px;border:2px solid #d97706;background:#fffbeb;color:#92400e;font-weight:700;text-align:center;">EMAIL TEST – ${escapeHtml(testLabel)}</div>`
    : '';
  const paymentHtml = paymentUrl
    ? `
      <p style="margin:24px 0 12px;color:#17202a;">Voici le lien de paiement pour votre réservation :</p>
      <p style="margin:0 0 12px;">
        <a href="${escapeHtml(paymentUrl)}" style="display:inline-block;padding:13px 18px;border-radius:5px;background:#000000;color:#ffffff;font-weight:700;text-decoration:none;">Régler ma réservation</a>
      </p>
      <p style="margin:0;overflow-wrap:anywhere;"><a href="${escapeHtml(paymentUrl)}" style="color:#465163;">${escapeHtml(paymentUrl)}</a></p>
    `
    : '';
  const html = `
    <!doctype html>
    <html lang="fr">
      <body style="margin:0;padding:0;background:#f4f5f3;font-family:Arial,sans-serif;color:#17202a;">
        <div style="max-width:620px;margin:0 auto;padding:28px 18px;">
          <div style="background:#ffffff;border:1px solid #dce2da;border-radius:8px;padding:28px;text-align:center;">
            ${testBanner}
            <div style="margin:0 0 28px;text-align:center;">
              <img src="${escapeHtml(logoUrl)}" width="300" alt="Zuru Zuru Supper Club" style="display:inline-block;width:100%;max-width:300px;height:auto;border:0;" />
            </div>
            <p style="margin:0 0 22px;">${escapeHtml(greeting)}</p>
            <p style="margin:0 0 18px;line-height:1.6;">Nous sommes très heureux de vous accueillir demain pour la toute première édition de notre Supper Club à La Réserve, au sein de Darwin.</p>
            <p style="margin:0 0 18px;line-height:1.6;">Notre envie est simple : réunir des bons vivants autour d'une grande table, partager un repas cuisiné avec passion à partir d'ingrédients de saison, locaux et soigneusement cultivés, dans un esprit de découverte, de générosité et de convivialité.</p>
            <p style="margin:0 0 24px;line-height:1.6;">Nous avons hâte de partager cette soirée avec vous !</p>
            <p style="margin:0 0 10px;"><strong>Voici quelques informations pratiques :</strong></p>
            <ul style="margin:0 0 24px;padding:0;line-height:1.7;list-style-position:inside;text-align:center;">
              <li>À partir de 18h30 : apéritif devant La Réserve</li>
              <li>20h30 : dîner en 4 services</li>
            </ul>
            <p style="margin:0 0 4px;"><strong>Adresse</strong></p>
            <p style="margin:0;line-height:1.55;">Darwin – La Réserve<br>87 Quai des Queyries<br>33100 Bordeaux</p>
            ${paymentHtml}
            <p style="margin:28px 0 0;line-height:1.6;">À demain,<br><br>Jérémie et Christophe</p>
          </div>
        </div>
      </body>
    </html>
  `;

  return { subject, text, html };
}

export async function sendSupperClubReminderEmail({
  to,
  firstName,
  paymentUrl,
  testLabel,
}: {
  to: string;
  firstName: string;
  paymentUrl?: string;
  testLabel?: string;
}) {
  const publicSiteUrl = (Deno.env.get('PUBLIC_SITE_URL') || 'https://lareserve.zuruzuru.fr').replace(/\/$/, '');
  const message = buildSupperClubReminderEmail({
    firstName,
    paymentUrl,
    testLabel,
    logoUrl: `${publicSiteUrl}/zuru-logo-email.png`,
  });
  return await sendEmail({ to, ...message });
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
    'Nos menus sont préparés sur mesure à partir de produits frais et locaux. Les annulations sont possibles uniquement jusqu’à 48 heures avant le dîner.',
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
      <p style="margin:24px 0 10px;color:#465163;"><strong>Annulation :</strong> nos menus sont préparés sur mesure à partir de produits frais et locaux. Les annulations sont possibles uniquement jusqu’à 48 heures avant le dîner.</p>
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

export async function sendReservationCancellationEmail(reservation: PaymentReservationEmailData) {
  const text = [
    'Réservation annulée', '',
    'Votre réservation a bien été annulée et vos places ont été libérées.',
    reservation.paymentAmountCents ? `Votre remboursement de ${formatMoneyCents(reservation.paymentAmountCents)} va être traité manuellement.` : '',
    '', 'Récapitulatif', buildSummaryText(reservation),
  ].filter(Boolean).join('\n');
  const html = wrapHtml(
    'Réservation annulée',
    'Votre réservation a bien été annulée et vos places ont été libérées.',
    `${buildSummaryHtml(reservation)}${reservation.paymentAmountCents ? `<p style="margin:0;color:#465163;">Votre remboursement de <strong>${formatMoneyCents(reservation.paymentAmountCents)}</strong> va être traité manuellement.</p>` : ''}`,
  );
  await sendEmail({ to: reservation.email, subject: 'Votre réservation Zuru Zuru est annulée', text, html });
}

export async function sendAdminRefundRequiredEmail(reservation: PaymentReservationEmailData) {
  const amount = formatMoneyCents(reservation.paymentAmountCents);
  const paymentId = String(reservation.helloAssoPaymentId || 'non renseigné');
  const text = [
    'Remboursement HelloAsso à effectuer', '',
    `Nom : ${getFullName(reservation)}`, `Email : ${reservation.email}`,
    `Montant : ${amount}`, `Identifiant paiement HelloAsso : ${paymentId}`,
    `Places : ${reservation.seats}`, `Date : ${formatLongDate(reservation.serviceDate)}`,
  ].join('\n');
  const html = wrapHtml(
    'Remboursement à effectuer',
    'Une réservation payée vient d’être annulée dans le délai autorisé.',
    `<div style="padding:16px;border:1px solid #d7dee8;border-radius:8px;background:#f8fafc;">
      <p><strong>Nom :</strong> ${escapeHtml(getFullName(reservation))}</p>
      <p><strong>Email :</strong> ${escapeHtml(reservation.email)}</p>
      <p><strong>Montant :</strong> ${amount}</p>
      <p><strong>Paiement HelloAsso :</strong> ${escapeHtml(paymentId)}</p>
      <p><strong>Places :</strong> ${reservation.seats}</p>
      <p><strong>Date :</strong> ${formatLongDate(reservation.serviceDate)}</p>
    </div>`,
  );
  await sendEmail({ to: ADMIN_RESERVATION_EMAIL, subject: `Remboursement HelloAsso à effectuer – ${amount}`, text, html, replyTo: reservation.email });
}

export async function sendAdminPaymentConflictEmail(reservation: any, reason: string) {
  const data: ReservationEmailData = {
    firstName: reservation.first_name || '', lastName: reservation.last_name || '',
    email: reservation.email, phone: reservation.phone, seats: reservation.seats,
    serviceDate: reservation.service_date,
  };
  const text = ['Conflit de paiement HelloAsso', '', reason, '', buildSummaryText(data)].join('\n');
  const html = wrapHtml('Paiement HelloAsso à vérifier', reason, buildSummaryHtml(data));
  await sendEmail({ to: ADMIN_RESERVATION_EMAIL, subject: 'Paiement HelloAsso à vérifier', text, html, replyTo: data.email });
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

export function buildReservationFeedbackEmail(
  reservation: ReservationEmailData,
  googleReviewUrl: string,
  {
    testLabel,
    logoUrl = 'https://lareserve.zuruzuru.fr/zuru-logo-email.png',
  }: { testLabel?: string; logoUrl?: string } = {},
) {
  const firstName = reservation.firstName.trim();
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
  const reviewUrl = googleReviewUrl.trim();
  const testText = testLabel ? [`[EMAIL TEST – ${testLabel}]`, ''] : [];
  const testHtml = testLabel
    ? `<div style="margin:0 0 20px;padding:12px;border:2px solid #d97706;background:#fffbeb;color:#92400e;font-weight:700;text-align:center;">EMAIL TEST – ${escapeHtml(testLabel)}</div>`
    : '';

  const text = [
    ...testText,
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
      ${testHtml}
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
    { headerLogoUrl: logoUrl },
  );

  return {
    subject: testLabel ? '[TEST] Votre avis sur le repas Zuru Zuru ?' : 'Votre avis sur le repas Zuru Zuru ?',
    text,
    html,
  };
}

export async function sendReservationFeedbackEmail(
  reservation: ReservationEmailData,
  googleReviewUrl: string,
  options: { testLabel?: string; logoUrl?: string } = {},
) {
  const message = buildReservationFeedbackEmail(reservation, googleReviewUrl, options);

  return await sendEmail({
    to: reservation.email,
    ...message,
  });
}

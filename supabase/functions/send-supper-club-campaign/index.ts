import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { errorResponse, jsonResponse, textResponse } from '../_shared/http.ts';
import { reconcileHelloAssoPayment } from '../_shared/helloasso-payment.ts';
import { getHelloAssoSiteUrl } from '../_shared/helloasso.ts';
import { calculatePaymentAmountCents } from '../_shared/payment-rules.ts';
import { sendSupperClubReminderEmail } from '../_shared/reservation-email.ts';

const CAMPAIGN_KEY = 'supper-club-2026-07-16-reminder';
const SERVICE_DATE = '2026-07-16';
const UNPAID_STATUSES = ['manual', 'pending', 'failed'];
const FAILED_RESEND_STATUSES = ['suppressed', 'failed', 'bounced', 'complained', 'canceled'];

function isFailedResendStatus(status: string) {
  return FAILED_RESEND_STATUSES.includes(status.toLowerCase());
}

async function getResendStatus(emailId: string) {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${requireEnv('RESEND_API_KEY')}` },
  });
  if (!response.ok) return 'accepted';
  const email = await response.json().catch(() => ({}));
  return String(email.last_event || 'accepted');
}

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret manquant: ${name}`);
  return value;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function createToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(digest));
}

function fullName(reservation: any) {
  return [reservation.first_name, reservation.last_name].filter(Boolean).join(' ').trim() || reservation.email;
}

function firstName(reservation: any) {
  const explicit = String(reservation.first_name || '').trim();
  if (explicit) return explicit.split(/\s+/)[0];
  return String(reservation.last_name || '').trim().split(/\s+/).filter(Boolean)[0] || 'invité';
}

function exclusionReason(reservation: any) {
  if (reservation.validation_status !== 'confirmed') {
    return `Réservation ${reservation.validation_status || 'non confirmée'}`;
  }
  const labels: Record<string, string> = {
    refund_pending: 'Remboursement à effectuer',
    refunded: 'Paiement remboursé',
    conflict: 'Paiement à vérifier',
  };
  return labels[reservation.payment_status] || `Statut de paiement ${reservation.payment_status}`;
}

function publicRecipient(reservation: any, delivery: any, audience?: 'paid' | 'unpaid') {
  return {
    reservationId: reservation.id,
    fullName: fullName(reservation),
    firstName: firstName(reservation),
    email: reservation.email,
    seats: Number(reservation.seats),
    validationStatus: reservation.validation_status,
    paymentStatus: reservation.payment_status,
    audience,
    delivery: delivery ? {
      status: delivery.status,
      attemptCount: Number(delivery.attempt_count),
      sentAt: delivery.sent_at,
      error: delivery.error_message,
    } : null,
  };
}

async function reconcilePendingReservations(supabase: any) {
  const { data: pending } = await supabase
    .from('reservations')
    .select('id')
    .eq('service_date', SERVICE_DATE)
    .eq('validation_status', 'confirmed')
    .eq('payment_status', 'pending');
  const warnings: Array<{ reservationId: string; error: string }> = [];

  for (const reservation of pending || []) {
    const { data: attempts } = await supabase
      .from('reservation_payment_attempts')
      .select('checkout_intent_id')
      .eq('reservation_id', reservation.id)
      .order('created_at', { ascending: false })
      .limit(3);
    for (const attempt of attempts || []) {
      try {
        const result = await reconcileHelloAssoPayment(
          supabase,
          reservation.id,
          Number(attempt.checkout_intent_id),
          getHelloAssoSiteUrl(),
        );
        if (result.status !== 'pending') break;
      } catch (error) {
        warnings.push({
          reservationId: reservation.id,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }
  }
  return warnings;
}

async function loadCampaign(supabase: any, reconcile = true) {
  const reconciliationWarnings = reconcile ? await reconcilePendingReservations(supabase) : [];
  const [{ data: reservations, error }, { data: deliveries }] = await Promise.all([
    supabase.from('reservations').select('*').eq('service_date', SERVICE_DATE).order('created_at'),
    supabase.from('reservation_email_deliveries').select('*').eq('campaign_key', CAMPAIGN_KEY),
  ]);
  if (error) throw new Error(error.message);
  const deliveryByReservation = new Map((deliveries || []).map((item: any) => [item.reservation_id, item]));
  const paid: any[] = [];
  const unpaid: any[] = [];
  const excluded: any[] = [];

  for (const reservation of reservations || []) {
    const delivery = deliveryByReservation.get(reservation.id);
    if (reservation.validation_status === 'confirmed' && reservation.payment_status === 'paid') {
      paid.push({ reservation, delivery, public: publicRecipient(reservation, delivery, 'paid') });
    } else if (
      reservation.validation_status === 'confirmed' &&
      UNPAID_STATUSES.includes(reservation.payment_status)
    ) {
      unpaid.push({ reservation, delivery, public: publicRecipient(reservation, delivery, 'unpaid') });
    } else {
      excluded.push({
        ...publicRecipient(reservation, delivery),
        reason: exclusionReason(reservation),
      });
    }
  }

  return {
    internal: { paid, unpaid },
    public: {
      campaignKey: CAMPAIGN_KEY,
      serviceDate: SERVICE_DATE,
      paid: paid.map((item) => item.public),
      unpaid: unpaid.map((item) => item.public),
      excluded,
      reconciliationWarnings,
    },
  };
}

async function claimDelivery(supabase: any, item: any, force: boolean) {
  const current = item.delivery;
  if (!force && current?.status === 'sent') return { skipped: 'already_sent' };
  if (!force && current?.status === 'sending') return { skipped: 'already_sending' };
  const now = new Date().toISOString();

  if (!current) {
    const { data, error } = await supabase.from('reservation_email_deliveries').insert({
      campaign_key: CAMPAIGN_KEY,
      reservation_id: item.reservation.id,
      audience: item.public.audience,
      recipient_email: item.reservation.email,
      status: 'sending',
      attempt_count: 1,
      last_attempt_at: now,
    }).select('*').single();
    if (error?.code === '23505') return { skipped: 'already_claimed' };
    if (error) throw new Error(error.message);
    return { delivery: data };
  }

  let query = supabase.from('reservation_email_deliveries').update({
    audience: item.public.audience,
    recipient_email: item.reservation.email,
    status: 'sending',
    attempt_count: Number(current.attempt_count) + 1,
    last_attempt_at: now,
    error_message: null,
  }).eq('id', current.id);
  if (!force) query = query.neq('status', 'sent').neq('status', 'sending');
  const { data, error } = await query.select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { delivery: data } : { skipped: 'already_claimed' };
}

async function sendToRecipient(supabase: any, item: any, force = false) {
  const claim = await claimDelivery(supabase, item, force);
  if (!claim.delivery) return { reservationId: item.reservation.id, skipped: claim.skipped };

  try {
    let paymentUrl: string | undefined;
    if (item.public.audience === 'unpaid') {
      const token = createToken();
      const createdAt = new Date().toISOString();
      const { error: tokenError } = await supabase.from('reservations').update({
        payment_link_token_hash: await hashToken(token),
        payment_link_created_at: createdAt,
        payment_amount_cents: calculatePaymentAmountCents(Number(item.reservation.seats)),
      }).eq('id', item.reservation.id);
      if (tokenError) throw new Error(tokenError.message);
      paymentUrl = `${getHelloAssoSiteUrl()}/reglement?token=${encodeURIComponent(token)}`;
    }

    const sent = await sendSupperClubReminderEmail({
      to: item.reservation.email,
      firstName: item.public.firstName,
      paymentUrl,
    });
    const resendStatus = await getResendStatus(sent.id);
    if (isFailedResendStatus(resendStatus)) {
      throw new Error(`Resend a classé cet email « ${resendStatus} » (${sent.id}).`);
    }
    const sentAt = new Date().toISOString();
    const { error: sentError } = await supabase.from('reservation_email_deliveries').update({
      status: 'sent', sent_at: sentAt, error_message: null,
    }).eq('id', claim.delivery.id);
    if (sentError) throw new Error(sentError.message);
    return { reservationId: item.reservation.id, email: item.reservation.email, sentAt, emailId: sent.id, resendStatus };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from('reservation_email_deliveries').update({
      status: 'failed', error_message: message,
    }).eq('id', claim.delivery.id);
    return { reservationId: item.reservation.id, email: item.reservation.email, error: message };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return textResponse('ok');
  if (req.method !== 'POST') return errorResponse('Méthode non autorisée.', 405);

  try {
    const authorization = req.headers.get('Authorization') || '';
    if (!authorization) return errorResponse('Connexion administrateur requise.', 401);
    const supabaseUrl = requireEnv('SUPABASE_URL');
    const authClient = createClient(supabaseUrl, requireEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) return errorResponse('Session administrateur invalide.', 401);

    const supabase = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });
    const { data: admin } = await supabase.from('admin_users').select('user_id')
      .eq('user_id', userData.user.id).maybeSingle();
    if (!admin) return errorResponse('Accès administrateur refusé.', 403);

    const payload = await req.json().catch(() => ({}));
    const action = String(payload.action || 'preview');

    if (action === 'test') {
      const adminFirstName = String(userData.user.user_metadata?.first_name || userData.user.email?.split('@')[0] || 'admin').split(/\s+/)[0];
      const variants = [
        { key: 'paid', label: 'Version invité déjà payé', paymentUrl: undefined },
        {
          key: 'unpaid',
          label: 'Version invité non payé',
          paymentUrl: `${getHelloAssoSiteUrl()}/reglement?token=LIEN-DE-TEST-NON-FONCTIONNEL`,
        },
      ];
      const results = [];
      for (const variant of variants) {
        try {
          const sent = await sendSupperClubReminderEmail({
            to: userData.user.email!,
            firstName: adminFirstName,
            paymentUrl: variant.paymentUrl,
            testLabel: `${variant.label.toUpperCase()}${variant.key === 'unpaid' ? ' – LIEN NON FONCTIONNEL' : ''}`,
          });
          const status = await getResendStatus(sent.id);
          const accepted = !isFailedResendStatus(status);
          results.push({
            variant: variant.key,
            label: variant.label,
            accepted,
            emailId: sent.id,
            status,
            error: accepted ? undefined : `Resend : ${status}`,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Échec email test ${variant.key}:`, message);
          results.push({ variant: variant.key, label: variant.label, accepted: false, error: message });
        }
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      return jsonResponse({
        testSent: results.every((result) => result.accepted),
        recipient: userData.user.email,
        count: results.filter((result) => result.accepted).length,
        results,
      });
    }

    const campaign = await loadCampaign(supabase, true);
    if (action === 'preview') return jsonResponse(campaign.public);

    if (action === 'send') {
      if (payload.confirm !== true) return errorResponse('Confirmation explicite requise.', 400);
      const results = [];
      const recipients = [...campaign.internal.paid, ...campaign.internal.unpaid];
      for (let index = 0; index < recipients.length; index += 1) {
        const item = recipients[index];
        results.push(await sendToRecipient(supabase, item, false));
        if (index < recipients.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
      }
      return jsonResponse({ ...campaign.public, results });
    }

    if (action === 'send-one' || action === 'resend') {
      if (payload.confirm !== true) return errorResponse('Confirmation explicite requise.', 400);
      const reservationId = String(payload.reservationId || '').trim();
      const item = [...campaign.internal.paid, ...campaign.internal.unpaid]
        .find((candidate) => candidate.reservation.id === reservationId);
      if (!item) return errorResponse('Destinataire éligible introuvable.', 404);
      const result = await sendToRecipient(supabase, item, item.delivery?.status === 'sent');
      return jsonResponse({ result });
    }

    return errorResponse('Action invalide.', 400);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Erreur inconnue.', 500);
  }
});

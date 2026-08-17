import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { errorResponse, jsonResponse, textResponse } from '../_shared/http.ts';
import { createCheckoutIntent, getHelloAssoSiteUrl } from '../_shared/helloasso.ts';
import {
  calculatePaymentAmountCents,
  CHECKOUT_URL_MINUTES,
  PAYMENT_HOLD_MINUTES,
} from '../_shared/payment-rules.ts';

const frenchPhonePattern = /^(?:(?:\+|00)33[\s.-]?[1-9](?:[\s.-]?\d{2}){4}|0[1-9](?:[\s.-]?\d{2}){4})$/;

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret manquant: ${name}`);
  return value;
}
function normalize(value: unknown) { return String(value ?? '').trim(); }
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
function splitName(fullName: string) {
  const parts = fullName.split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || 'Client', lastName: parts.slice(1).join(' ') || parts[0] || 'Zuru Zuru' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return textResponse('ok');
  if (req.method !== 'POST') return errorResponse('Méthode non autorisée.', 405);

  try {
    const payload = await req.json();
    const serviceDate = normalize(payload.date);
    const fullName = normalize(payload.lastName);
    const email = normalize(payload.email).toLowerCase();
    const phone = normalize(payload.phone);
    const seats = Number(payload.seats);
    if (!serviceDate || new Date(`${serviceDate}T12:00:00Z`).getUTCDay() !== 4) return errorResponse('Date invalide.', 400);
    if (!fullName) return errorResponse('Nom complet requis.', 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return errorResponse('Email invalide.', 400);
    if (!frenchPhonePattern.test(phone)) return errorResponse('Numéro de téléphone français invalide.', 400);
    if (!Number.isInteger(seats) || seats < 1 || seats > 24) return errorResponse('Nombre de places invalide.', 400);

    const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const publicSiteUrl = getHelloAssoSiteUrl();
    const now = new Date();
    const holdExpiresAt = new Date(now.getTime() + PAYMENT_HOLD_MINUTES * 60_000).toISOString();
    const checkoutExpiresAt = new Date(now.getTime() + CHECKOUT_URL_MINUTES * 60_000).toISOString();
    const amountCents = calculatePaymentAmountCents(seats);
    const returnToken = createToken();
    const returnTokenHash = await hashToken(returnToken);

    const { data: existingRows, error: existingError } = await supabase
      .from('reservations').select('*').eq('service_date', serviceDate).eq('email', email)
      .in('validation_status', ['pending', 'confirmed']).order('created_at', { ascending: false });
    if (existingError) throw new Error(existingError.message);

    const expiredIds = (existingRows || []).filter((row: any) =>
      row.validation_status === 'pending' &&
      (!row.validation_expires_at || new Date(row.validation_expires_at).getTime() <= Date.now())
    ).map((row: any) => row.id);
    if (expiredIds.length) {
      await supabase.from('reservations').update({ validation_status: 'expired', payment_status: 'failed' }).in('id', expiredIds);
      await supabase.from('reservation_payment_attempts').update({ status: 'expired' }).in('reservation_id', expiredIds).eq('status', 'pending');
    }

    let reservation = (existingRows || []).find((row: any) =>
      row.validation_status === 'confirmed' ||
      (row.validation_status === 'pending' && row.validation_expires_at && new Date(row.validation_expires_at).getTime() > Date.now())
    );
    if (reservation?.validation_status === 'confirmed') {
      return jsonResponse({ status: 'duplicate', message: 'Une réservation confirmée existe déjà avec cet email.' });
    }
    if (reservation && reservation.payment_status !== 'pending') {
      return jsonResponse({
        status: 'duplicate',
        message: 'Une réservation en cours de validation existe déjà avec cet email.',
        reservation: { serviceDate: reservation.service_date, seats: reservation.seats },
      });
    }

    let isNewReservation = false;
    if (reservation) {
      const { data: activeAttempt } = await supabase.from('reservation_payment_attempts').select('*')
        .eq('reservation_id', reservation.id).eq('status', 'pending').gt('expires_at', now.toISOString())
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (activeAttempt?.checkout_url) {
        return jsonResponse({ status: 'checkout', checkoutUrl: activeAttempt.checkout_url, amountCents, seats });
      }
      const { data: refreshed, error: refreshError } = await supabase.from('reservations').update({
        last_name: fullName, phone, seats, payment_amount_cents: amountCents,
        payment_status: 'pending', validation_expires_at: holdExpiresAt,
        payment_return_token_hash: returnTokenHash,
      }).eq('id', reservation.id).select('*').single();
      if (refreshError) throw new Error(refreshError.message);
      reservation = refreshed;
    } else {
      const { data: created, error: createError } = await supabase.from('reservations').insert({
        service_date: serviceDate, first_name: '', last_name: fullName, email, phone, seats,
        validation_status: 'pending', validation_expires_at: holdExpiresAt,
        confirmed_at: null, payment_status: 'pending', payment_amount_cents: amountCents,
        payment_created_at: now.toISOString(), payment_return_token_hash: returnTokenHash,
      }).select('*').single();
      if (createError) throw new Error(createError.message);
      reservation = created;
      isNewReservation = true;
    }

    const payer = splitName(fullName);
    const resultUrl = `${publicSiteUrl}/paiement?token=${encodeURIComponent(returnToken)}`;
    try {
      const checkout = await createCheckoutIntent(supabase, {
        totalAmount: amountCents,
        initialAmount: amountCents,
        itemName: `${seats} menu${seats > 1 ? 's' : ''} Zuru Zuru – ${serviceDate}`,
        backUrl: `${publicSiteUrl}/inscription?payment=back`,
        errorUrl: `${resultUrl}&type=error`,
        returnUrl: resultUrl,
        containsDonation: false,
        payer: { ...payer, email },
        metadata: { reservationId: reservation.id, serviceDate, seats, amountCents },
      });
      const checkoutIntentId = Number(checkout.id);
      if (!checkout.redirectUrl || !Number.isFinite(checkoutIntentId)) throw new Error('Réponse Checkout incomplète.');
      const { error: attemptError } = await supabase.from('reservation_payment_attempts').insert({
        reservation_id: reservation.id, checkout_intent_id: checkoutIntentId,
        checkout_url: checkout.redirectUrl, amount_cents: amountCents, expires_at: checkoutExpiresAt,
      });
      if (attemptError) throw new Error(attemptError.message);
      return jsonResponse({ status: 'checkout', checkoutUrl: checkout.redirectUrl, amountCents, seats });
    } catch (checkoutError) {
      if (isNewReservation) await supabase.from('reservations').delete().eq('id', reservation.id);
      else await supabase.from('reservations').update({ payment_status: 'failed', validation_status: 'expired' }).eq('id', reservation.id);
      throw checkoutError;
    }
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Erreur inconnue.', 500);
  }
});

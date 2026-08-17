import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { errorResponse, jsonResponse, textResponse } from '../_shared/http.ts';
import { createCheckoutIntent, getHelloAssoSiteUrl } from '../_shared/helloasso.ts';
import { calculatePaymentAmountCents, CHECKOUT_URL_MINUTES } from '../_shared/payment-rules.ts';

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

function publicReservation(reservation: any) {
  const fullName = [reservation.first_name, reservation.last_name].filter(Boolean).join(' ').trim();
  return {
    fullName: fullName || 'Invité Zuru Zuru',
    serviceDate: reservation.service_date,
    seats: Number(reservation.seats),
    amountCents: calculatePaymentAmountCents(Number(reservation.seats)),
    paymentStatus: reservation.payment_status,
  };
}

function splitName(reservation: any) {
  if (String(reservation.first_name || '').trim()) {
    return {
      firstName: String(reservation.first_name).trim(),
      lastName: String(reservation.last_name || '').trim() || String(reservation.first_name).trim(),
    };
  }
  const parts = String(reservation.last_name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || 'Client',
    lastName: parts.slice(1).join(' ') || parts[0] || 'Zuru Zuru',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return textResponse('ok');
  if (req.method !== 'POST') return errorResponse('Méthode non autorisée.', 405);

  try {
    const payload = await req.json().catch(() => ({}));
    const token = String(payload.token || '').trim();
    const action = String(payload.action || 'preview');
    if (!token) return errorResponse('Lien de paiement invalide.', 400);

    const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });
    const { data: reservation } = await supabase
      .from('reservations')
      .select('*')
      .eq('payment_link_token_hash', await hashToken(token))
      .maybeSingle();
    if (!reservation) return errorResponse('Ce lien de paiement est invalide ou a été remplacé.', 404);

    const summary = publicReservation(reservation);
    if (action === 'preview') return jsonResponse({ status: reservation.payment_status, reservation: summary });
    if (action !== 'checkout') return errorResponse('Action invalide.', 400);
    if (['paid', 'refund_pending', 'refunded'].includes(reservation.payment_status)) {
      return jsonResponse({ status: 'paid', reservation: summary });
    }
    if (reservation.validation_status !== 'confirmed') {
      return errorResponse('Cette réservation ne peut plus être réglée.', 409);
    }
    if (reservation.payment_status === 'conflict') {
      return errorResponse('Ce paiement nécessite une vérification par notre équipe.', 409);
    }

    const now = new Date();
    const { data: activeAttempt } = await supabase
      .from('reservation_payment_attempts')
      .select('checkout_url, expires_at')
      .eq('reservation_id', reservation.id)
      .eq('status', 'pending')
      .gt('expires_at', now.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeAttempt?.checkout_url) {
      return jsonResponse({ status: 'checkout', checkoutUrl: activeAttempt.checkout_url, reservation: summary });
    }

    await supabase
      .from('reservation_payment_attempts')
      .update({ status: 'expired' })
      .eq('reservation_id', reservation.id)
      .eq('status', 'pending')
      .lte('expires_at', now.toISOString());

    const amountCents = summary.amountCents;
    const returnToken = createToken();
    const returnTokenHash = await hashToken(returnToken);
    const publicSiteUrl = getHelloAssoSiteUrl();
    const resultUrl = `${publicSiteUrl}/paiement?token=${encodeURIComponent(returnToken)}`;
    const checkoutExpiresAt = new Date(now.getTime() + CHECKOUT_URL_MINUTES * 60_000).toISOString();
    const payer = splitName(reservation);
    const previousPaymentStatus = reservation.payment_status;

    const { error: pendingError } = await supabase
      .from('reservations')
      .update({
        payment_status: 'pending',
        payment_amount_cents: amountCents,
        payment_created_at: now.toISOString(),
        payment_return_token_hash: returnTokenHash,
        payment_conflict_reason: null,
      })
      .eq('id', reservation.id);
    if (pendingError) throw new Error(pendingError.message);

    try {
      const checkout = await createCheckoutIntent(supabase, {
        totalAmount: amountCents,
        initialAmount: amountCents,
        itemName: `${summary.seats} menu${summary.seats > 1 ? 's' : ''} Zuru Zuru – ${summary.serviceDate}`,
        backUrl: `${publicSiteUrl}/reglement?token=${encodeURIComponent(token)}`,
        errorUrl: `${resultUrl}&type=error`,
        returnUrl: resultUrl,
        containsDonation: false,
        payer: { ...payer, email: reservation.email },
        metadata: {
          reservationId: reservation.id,
          serviceDate: summary.serviceDate,
          seats: summary.seats,
          amountCents,
          paymentLink: true,
        },
      });
      const checkoutIntentId = Number(checkout.id);
      if (!checkout.redirectUrl || !Number.isFinite(checkoutIntentId)) {
        throw new Error('Réponse Checkout incomplète.');
      }
      const { error: attemptError } = await supabase.from('reservation_payment_attempts').insert({
        reservation_id: reservation.id,
        checkout_intent_id: checkoutIntentId,
        checkout_url: checkout.redirectUrl,
        amount_cents: amountCents,
        expires_at: checkoutExpiresAt,
      });
      if (attemptError) throw new Error(attemptError.message);
      return jsonResponse({ status: 'checkout', checkoutUrl: checkout.redirectUrl, reservation: summary });
    } catch (checkoutError) {
      await supabase.from('reservations').update({
        payment_status: previousPaymentStatus,
        payment_amount_cents: reservation.payment_amount_cents,
        payment_created_at: reservation.payment_created_at,
        payment_return_token_hash: reservation.payment_return_token_hash,
      }).eq('id', reservation.id);
      throw checkoutError;
    }
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Erreur inconnue.', 500);
  }
});

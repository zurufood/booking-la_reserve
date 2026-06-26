import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { corsHeaders, errorResponse, jsonResponse, textResponse } from '../_shared/http.ts';

const MOLLIE_API_URL = 'https://api.mollie.com/v2/payments';

type ReservationResult = {
  id: string;
  service_date: string;
  seats: number;
  deposit_per_seat: number;
  deposit_total: number;
  deposit_status: string;
  remaining_seats: number;
};

type MolliePayment = {
  id: string;
  status: string;
  amount: {
    currency: string;
    value: string;
  };
  createdAt?: string;
  metadata?: {
    reservation_id?: string;
  };
  _links?: {
    checkout?: {
      href?: string;
    };
  };
};

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Secret manquant: ${name}`);
  }
  return value;
}

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '');
}

function getDepositPerSeat() {
  const value = Number(Deno.env.get('DEPOSIT_PER_SEAT') ?? '10');
  return Number.isFinite(value) && value >= 0 ? value : 10;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return textResponse('ok');
  }

  if (req.method !== 'POST') {
    return errorResponse('Méthode non autorisée.', 405);
  }

  try {
    const mollieApiKey = requireEnv('MOLLIE_API_KEY');
    const publicSiteUrl = normalizeBaseUrl(requireEnv('PUBLIC_SITE_URL'));
    const mollieWebhookUrl = requireEnv('MOLLIE_WEBHOOK_URL');
    const supabaseUrl = requireEnv('SUPABASE_URL');
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    const depositPerSeat = getDepositPerSeat();

    const payload = await req.json();
    const serviceDate = String(payload.date ?? '');
    const email = String(payload.email ?? '').trim().toLowerCase();
    const phone = String(payload.phone ?? '').trim();
    const seats = Number(payload.seats);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    const { data: reservationData, error: reservationError } = await supabase.rpc(
      'create_public_reservation',
      {
        p_service_date: serviceDate,
        p_email: email,
        p_phone: phone,
        p_seats: seats,
        p_deposit_per_seat: depositPerSeat,
      },
    );

    if (reservationError) {
      return errorResponse(reservationError.message, 400);
    }

    const reservation = (reservationData?.[0] ?? null) as ReservationResult | null;
    if (!reservation) {
      return errorResponse('Inscription impossible.', 500);
    }

    const amountCents = reservation.seats * reservation.deposit_per_seat * 100;
    const amountValue = (amountCents / 100).toFixed(2);
    const redirectUrl = `${publicSiteUrl}/inscription?payment=return&reservation=${reservation.id}`;

    const mollieResponse = await fetch(MOLLIE_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mollieApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: {
          currency: 'EUR',
          value: amountValue,
        },
        description: `Acompte restaurant éphémère - ${reservation.seats} place${
          reservation.seats > 1 ? 's' : ''
        }`,
        redirectUrl,
        webhookUrl: mollieWebhookUrl,
        metadata: {
          reservation_id: reservation.id,
        },
      }),
    });

    if (!mollieResponse.ok) {
      const errorText = await mollieResponse.text();
      await supabase
        .from('reservations')
        .update({ payment_status: 'setup_failed' })
        .eq('id', reservation.id);

      return errorResponse(
        `Paiement Mollie impossible: ${errorText || mollieResponse.statusText}`,
        502,
      );
    }

    const payment = (await mollieResponse.json()) as MolliePayment;
    const checkoutUrl = payment._links?.checkout?.href;

    if (!payment.id || !checkoutUrl) {
      await supabase
        .from('reservations')
        .update({ payment_status: 'missing_checkout_url' })
        .eq('id', reservation.id);

      return errorResponse('Mollie n’a pas renvoyé de lien de paiement.', 502);
    }

    const { error: updateError } = await supabase
      .from('reservations')
      .update({
        mollie_payment_id: payment.id,
        mollie_checkout_url: checkoutUrl,
        payment_status: payment.status || 'open',
        payment_amount_cents: amountCents,
        payment_created_at: payment.createdAt ?? new Date().toISOString(),
      })
      .eq('id', reservation.id);

    if (updateError) {
      return errorResponse(updateError.message, 500);
    }

    return jsonResponse({
      reservationId: reservation.id,
      serviceDate: reservation.service_date,
      seats: reservation.seats,
      checkoutUrl,
      paymentId: payment.id,
      paymentStatus: payment.status || 'open',
      amountCents,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Erreur inconnue.', 500);
  }
});

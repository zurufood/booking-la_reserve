import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { errorResponse, textResponse } from '../_shared/http.ts';

type MolliePayment = {
  id: string;
  status: string;
  amount: {
    currency: string;
    value: string;
  };
  metadata?: {
    reservation_id?: string;
  };
};

type ReservationRow = {
  id: string;
  seats: number;
  deposit_per_seat: number;
  mollie_payment_id: string | null;
  payment_amount_cents: number | null;
};

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Secret manquant: ${name}`);
  }
  return value;
}

function amountToCents(value: string) {
  const [euros = '0', cents = '0'] = value.split('.');
  return Number(euros) * 100 + Number(cents.padEnd(2, '0').slice(0, 2));
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
    const supabaseUrl = requireEnv('SUPABASE_URL');
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    const body = await req.text();
    const paymentId = new URLSearchParams(body).get('id');

    if (!paymentId) {
      return errorResponse('Identifiant paiement manquant.', 400);
    }

    const mollieResponse = await fetch(`https://api.mollie.com/v2/payments/${paymentId}`, {
      headers: {
        Authorization: `Bearer ${mollieApiKey}`,
      },
    });

    if (!mollieResponse.ok) {
      return errorResponse('Paiement Mollie introuvable.', 502);
    }

    const payment = (await mollieResponse.json()) as MolliePayment;
    const reservationId = payment.metadata?.reservation_id;

    if (!reservationId) {
      return errorResponse('Réservation manquante dans les métadonnées Mollie.', 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    const { data: reservationData, error: reservationError } = await supabase
      .from('reservations')
      .select('id, seats, deposit_per_seat, mollie_payment_id, payment_amount_cents')
      .eq('id', reservationId)
      .single();

    const reservation = reservationData as ReservationRow | null;

    if (reservationError || !reservation) {
      return errorResponse('Réservation introuvable.', 404);
    }

    if (reservation.mollie_payment_id && reservation.mollie_payment_id !== payment.id) {
      return errorResponse('Le paiement Mollie ne correspond pas à la réservation.', 400);
    }

    if (payment.amount.currency !== 'EUR') {
      return errorResponse('Devise Mollie invalide.', 400);
    }

    const expectedAmountCents =
      reservation.payment_amount_cents ?? reservation.seats * reservation.deposit_per_seat * 100;
    const receivedAmountCents = amountToCents(payment.amount.value);

    if (expectedAmountCents !== receivedAmountCents) {
      return errorResponse('Montant Mollie invalide.', 400);
    }

    const updatePayload: Record<string, string | null> = {
      payment_status: payment.status,
    };

    if (payment.status === 'paid') {
      updatePayload.deposit_status = 'paye';
      updatePayload.payment_paid_at = new Date().toISOString();
    }

    const { error: updateError } = await supabase
      .from('reservations')
      .update(updatePayload)
      .eq('id', reservation.id);

    if (updateError) {
      return errorResponse(updateError.message, 500);
    }

    return textResponse('ok');
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Erreur inconnue.', 500);
  }
});

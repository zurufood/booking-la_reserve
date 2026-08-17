import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { errorResponse, jsonResponse, textResponse } from '../_shared/http.ts';
import {
  sendAdminRefundRequiredEmail,
  sendReservationCancellationEmail,
} from '../_shared/reservation-email.ts';

type ReservationRow = {
  id: string;
  service_date: string;
  first_name: string;
  last_name: string;
  email: string;
  seats: number;
  validation_status: string;
  phone: string;
  payment_status: string;
  payment_amount_cents: number | null;
  helloasso_payment_id: number | null;
};

type CancellationPayload = {
  token?: unknown;
  confirm?: unknown;
};

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Secret manquant: ${name}`);
  }
  return value;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function hashToken(token: string) {
  const encodedToken = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encodedToken);
  return toBase64Url(new Uint8Array(hashBuffer));
}

function reservationPayload(reservation: ReservationRow) {
  return {
    reservationId: reservation.id,
    serviceDate: reservation.service_date,
    seats: reservation.seats,
    firstName: reservation.first_name,
    lastName: reservation.last_name,
    email: reservation.email,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return textResponse('ok');
  }

  if (req.method !== 'POST') {
    return errorResponse('Méthode non autorisée.', 405);
  }

  try {
    const supabaseUrl = requireEnv('SUPABASE_URL');
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    const payload = (await req.json().catch(() => ({}))) as CancellationPayload;
    const token = String(payload.token ?? '').trim();
    const shouldCancel = payload.confirm === true;

    if (!token) {
      return jsonResponse({
        status: 'invalid',
        message: "Lien d'annulation invalide.",
      });
    }

    const tokenHash = await hashToken(token);
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    const { data, error } = await supabase
      .from('reservations')
      .select('id, service_date, first_name, last_name, email, phone, seats, validation_status, payment_status, payment_amount_cents, helloasso_payment_id')
      .eq('cancellation_token_hash', tokenHash)
      .maybeSingle();

    if (error) {
      return errorResponse(error.message, 500);
    }

    if (!data) {
      return jsonResponse({
        status: 'invalid',
        message: "Ce lien d'annulation est invalide ou a déjà été utilisé.",
      });
    }

    const reservation = data as ReservationRow;

    if (reservation.validation_status !== 'confirmed') {
      return jsonResponse({
        status: 'invalid',
        message: "Cette réservation ne peut plus être annulée via ce lien.",
        reservation: reservationPayload(reservation),
      });
    }

    const { data: deadline, error: deadlineError } = await supabase.rpc(
      'reservation_cancellation_deadline',
      { p_service_date: reservation.service_date },
    );
    if (deadlineError) return errorResponse(deadlineError.message, 500);
    const cancellationDeadline = String(deadline);
    if (new Date(cancellationDeadline).getTime() <= Date.now()) {
      return jsonResponse({
        status: 'cutoff',
        message: 'Le délai d’annulation est dépassé. Nos menus sont préparés sur mesure à partir de produits frais et locaux ; les annulations sont possibles uniquement jusqu’à 48 heures avant le dîner.',
        cancellationDeadline,
        reservation: reservationPayload(reservation),
      });
    }

    if (!shouldCancel) {
      return jsonResponse({
        status: 'ready',
        message: 'Confirmez-vous l’annulation de cette réservation ? Les places seront libérées et le remboursement sera ensuite traité manuellement.',
        cancellationDeadline,
        reservation: reservationPayload(reservation),
      });
    }

    const paidReservation = reservation.payment_status === 'paid';
    const now = new Date().toISOString();
    const { error: cancelError } = await supabase
      .from('reservations')
      .update({
        validation_status: 'cancelled',
        cancellation_token_hash: null,
        payment_status: paidReservation ? 'refund_pending' : reservation.payment_status,
        refund_requested_at: paidReservation ? now : null,
      })
      .eq('id', reservation.id)
      .eq('cancellation_token_hash', tokenHash);

    if (cancelError) {
      return errorResponse(cancelError.message, 500);
    }

    const emailData = {
      firstName: reservation.first_name,
      lastName: reservation.last_name,
      email: reservation.email,
      phone: reservation.phone,
      seats: reservation.seats,
      serviceDate: reservation.service_date,
      paymentAmountCents: paidReservation ? reservation.payment_amount_cents : null,
      helloAssoPaymentId: reservation.helloasso_payment_id,
    };
    await sendReservationCancellationEmail(emailData).catch(console.error);
    if (paidReservation) await sendAdminRefundRequiredEmail(emailData).catch(console.error);

    return jsonResponse({
      status: 'cancelled',
      message: paidReservation
        ? 'Votre réservation a bien été annulée. Vos places sont libérées et votre remboursement va être traité manuellement.'
        : 'Votre réservation a bien été annulée.',
      reservation: reservationPayload(reservation),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Erreur inconnue.', 500);
  }
});

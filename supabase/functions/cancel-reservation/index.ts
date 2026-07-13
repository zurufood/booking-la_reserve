import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { errorResponse, jsonResponse, textResponse } from '../_shared/http.ts';

type ReservationRow = {
  id: string;
  service_date: string;
  first_name: string;
  last_name: string;
  email: string;
  seats: number;
  validation_status: string;
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
      .select('id, service_date, first_name, last_name, email, seats, validation_status')
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

    if (!shouldCancel) {
      return jsonResponse({
        status: 'ready',
        message: 'Confirmez-vous l’annulation de cette réservation ?',
        reservation: reservationPayload(reservation),
      });
    }

    const { error: deleteError } = await supabase
      .from('reservations')
      .delete()
      .eq('id', reservation.id)
      .eq('cancellation_token_hash', tokenHash);

    if (deleteError) {
      return errorResponse(deleteError.message, 500);
    }

    return jsonResponse({
      status: 'cancelled',
      message: 'Votre réservation a bien été annulée.',
      reservation: reservationPayload(reservation),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Erreur inconnue.', 500);
  }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { errorResponse, jsonResponse, textResponse } from '../_shared/http.ts';
import {
  sendAdminReservationConfirmedEmail,
  sendReservationConfirmedEmail,
} from '../_shared/reservation-email.ts';

type ReservationRow = {
  id: string;
  service_date: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  seats: number;
  validation_status: string;
  validation_expires_at: string | null;
  confirmation_email_sent_at: string | null;
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

function createToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
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
    const publicSiteUrl = requireEnv('PUBLIC_SITE_URL').replace(/\/$/, '');
    const payload = await req.json();
    const token = String(payload.token ?? '').trim();

    if (!token) {
      return jsonResponse({
        status: 'invalid',
        message: 'Lien de validation invalide.',
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
      .select(
        'id, service_date, first_name, last_name, email, phone, seats, validation_status, validation_expires_at, confirmation_email_sent_at',
      )
      .eq('validation_token_hash', tokenHash)
      .single();

    if (error || !data) {
      return jsonResponse({
        status: 'invalid',
        message: 'Lien de validation invalide.',
      });
    }

    const reservation = data as ReservationRow;

    if (reservation.validation_status === 'confirmed') {
      return jsonResponse({
        status: 'already_confirmed',
        message: 'Votre inscription est déjà confirmée.',
        reservation: reservationPayload(reservation),
      });
    }

    if (reservation.validation_status === 'cancelled') {
      return jsonResponse({
        status: 'cancelled',
        message: 'Cette inscription a été annulée.',
        reservation: reservationPayload(reservation),
      });
    }

    if (
      reservation.validation_status === 'expired' ||
      !reservation.validation_expires_at ||
      new Date(reservation.validation_expires_at).getTime() <= Date.now()
    ) {
      if (reservation.validation_status !== 'expired') {
        await supabase
          .from('reservations')
          .update({ validation_status: 'expired' })
          .eq('id', reservation.id);
      }

      return jsonResponse({
        status: 'expired',
        message: 'Ce lien a expiré. Merci de refaire une inscription.',
        reservation: reservationPayload(reservation),
      });
    }

    const confirmedAt = new Date().toISOString();
    const cancellationToken = createToken();
    const cancellationTokenHash = await hashToken(cancellationToken);
    const cancellationUrl = `${publicSiteUrl}/annulation?token=${encodeURIComponent(
      cancellationToken,
    )}`;

    const { data: updatedData, error: updateError } = await supabase
      .from('reservations')
      .update({
        validation_status: 'confirmed',
        confirmed_at: confirmedAt,
        cancellation_token_hash: cancellationTokenHash,
      })
      .eq('id', reservation.id)
      .select(
        'id, service_date, first_name, last_name, email, phone, seats, validation_status, validation_expires_at, confirmation_email_sent_at',
      )
      .single();

    if (updateError || !updatedData) {
      return errorResponse(updateError?.message || 'Confirmation impossible.', 500);
    }

    const confirmedReservation = updatedData as ReservationRow;
    const reservationEmailData = {
      firstName: confirmedReservation.first_name,
      lastName: confirmedReservation.last_name,
      email: confirmedReservation.email,
      phone: confirmedReservation.phone,
      seats: confirmedReservation.seats,
      serviceDate: confirmedReservation.service_date,
    };
    let emailSent = false;
    let adminEmailSent = false;

    try {
      await sendReservationConfirmedEmail(reservationEmailData, cancellationUrl);

      const emailSentAt = new Date().toISOString();
      await supabase
        .from('reservations')
        .update({ confirmation_email_sent_at: emailSentAt })
        .eq('id', confirmedReservation.id);
      emailSent = true;
    } catch (emailError) {
      console.error(emailError instanceof Error ? emailError.message : emailError);
    }

    try {
      await sendAdminReservationConfirmedEmail(reservationEmailData);
      adminEmailSent = true;
    } catch (adminEmailError) {
      console.error(adminEmailError instanceof Error ? adminEmailError.message : adminEmailError);
    }

    return jsonResponse({
      status: 'confirmed',
      message: emailSent
        ? 'Votre inscription est confirmée. Un email de confirmation vient de vous être envoyé.'
        : 'Votre inscription est confirmée.',
      emailSent,
      adminEmailSent,
      reservation: reservationPayload(confirmedReservation),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Erreur inconnue.', 500);
  }
});

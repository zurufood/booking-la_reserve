import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { errorResponse, jsonResponse, textResponse } from '../_shared/http.ts';
import { sendReservationValidationEmail } from '../_shared/reservation-email.ts';

const DEFAULT_TOKEN_TTL_MINUTES = 120;
const frenchPhonePattern =
  /^(?:(?:\+|00)33[\s.-]?[1-9](?:[\s.-]?\d{2}){4}|0[1-9](?:[\s.-]?\d{2}){4})$/;

type ReservationRow = {
  id: string;
  created_at?: string;
  service_date: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  seats: number;
  validation_status?: string;
  validation_expires_at: string;
};

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Secret manquant: ${name}`);
  }
  return value;
}

function normalizeString(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeEmail(value: unknown) {
  return normalizeString(value).toLowerCase();
}

function isFrenchPhoneNumber(value: string) {
  return frenchPhonePattern.test(value);
}

function getTokenTtlMinutes() {
  const rawValue = Deno.env.get('VALIDATION_TOKEN_TTL_MINUTES');
  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : DEFAULT_TOKEN_TTL_MINUTES;
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

function isActiveExistingReservation(reservation: ReservationRow) {
  return (
    reservation.validation_status === 'confirmed' ||
    (reservation.validation_status === 'pending' &&
      reservation.validation_expires_at &&
      new Date(reservation.validation_expires_at).getTime() > Date.now())
  );
}

function reservationPayload(reservation: ReservationRow) {
  return {
    reservationId: reservation.id,
    serviceDate: reservation.service_date,
    seats: reservation.seats,
    validationStatus: reservation.validation_status || 'confirmed',
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

    const serviceDate = normalizeString(payload.date);
    const lastName = normalizeString(payload.lastName);
    const email = normalizeEmail(payload.email);
    const phone = normalizeString(payload.phone);
    const seats = Number(payload.seats);

    if (!serviceDate) {
      return errorResponse('Date manquante.', 400);
    }

    if (!lastName) {
      return errorResponse('Nom complet requis.', 400);
    }

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return errorResponse('Email invalide.', 400);
    }

    if (!phone) {
      return errorResponse('Téléphone requis.', 400);
    }

    if (!isFrenchPhoneNumber(phone)) {
      return errorResponse('Numéro de téléphone français invalide.', 400);
    }

    if (!Number.isInteger(seats) || seats < 1 || seats > 24) {
      return errorResponse('Nombre de places invalide.', 400);
    }

    const token = createToken();
    const tokenHash = await hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + getTokenTtlMinutes() * 60 * 1000).toISOString();
    const validationUrl = `${publicSiteUrl}/validation?token=${encodeURIComponent(token)}`;

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    const { data: existingReservations, error: existingError } = await supabase
      .from('reservations')
      .select(
        'id, created_at, service_date, first_name, last_name, email, phone, seats, validation_status, validation_expires_at',
      )
      .eq('service_date', serviceDate)
      .eq('email', email)
      .in('validation_status', ['pending', 'confirmed'])
      .order('created_at', { ascending: false });

    if (existingError) {
      return errorResponse(existingError.message, 400);
    }

    const existingReservation = ((existingReservations || []) as ReservationRow[]).find(
      isActiveExistingReservation,
    );

    const expiredReservationIds = ((existingReservations || []) as ReservationRow[])
      .filter(
        (reservation) =>
          reservation.validation_status === 'pending' && !isActiveExistingReservation(reservation),
      )
      .map((reservation) => reservation.id);

    if (expiredReservationIds.length > 0) {
      await supabase
        .from('reservations')
        .update({ validation_status: 'expired' })
        .in('id', expiredReservationIds);
    }

    if (existingReservation) {
      return jsonResponse({
        status: 'duplicate',
        message:
          'Une réservation a déjà été faite avec cette adresse email. Vous pouvez demander le renvoi du récapitulatif.',
        reservation: reservationPayload(existingReservation),
      });
    }

    const { data, error } = await supabase
      .from('reservations')
      .insert({
        service_date: serviceDate,
        first_name: '',
        last_name: lastName,
        email,
        phone,
        seats,
        validation_status: 'pending',
        validation_token_hash: tokenHash,
        validation_sent_at: now.toISOString(),
        validation_expires_at: expiresAt,
        confirmed_at: null,
        confirmation_email_sent_at: null,
      })
      .select('id, service_date, first_name, last_name, email, phone, seats, validation_expires_at')
      .single();

    if (error) {
      return errorResponse(error.message, 400);
    }

    const reservation = data as ReservationRow;

    try {
      await sendReservationValidationEmail(
        {
          firstName: reservation.first_name,
          lastName: reservation.last_name,
          email: reservation.email,
          phone: reservation.phone,
          seats: reservation.seats,
          serviceDate: reservation.service_date,
        },
        validationUrl,
        reservation.validation_expires_at,
      );
    } catch (emailError) {
      await supabase.from('reservations').delete().eq('id', reservation.id);
      throw emailError;
    }

    return jsonResponse({
      reservationId: reservation.id,
      serviceDate: reservation.service_date,
      seats: reservation.seats,
      validationStatus: 'pending',
      validationExpiresAt: reservation.validation_expires_at,
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Erreur inconnue.', 500);
  }
});

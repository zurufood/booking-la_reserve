import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { errorResponse, jsonResponse, textResponse } from '../_shared/http.ts';
import { sendReservationSummaryEmail } from '../_shared/reservation-email.ts';

const DEFAULT_TOKEN_TTL_MINUTES = 120;
const RESEND_COOLDOWN_MS = 60 * 1000;
const RESERVATION_SELECT = [
  'id',
  'created_at',
  'service_date',
  'first_name',
  'last_name',
  'email',
  'phone',
  'seats',
  'validation_status',
  'validation_token_hash',
  'validation_sent_at',
  'validation_expires_at',
  'cancellation_token_hash',
  'confirmation_email_sent_at',
].join(', ');

type ReservationRow = {
  id: string;
  created_at: string;
  service_date: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  seats: number;
  validation_status: string;
  validation_token_hash: string | null;
  validation_sent_at: string | null;
  validation_expires_at: string | null;
  cancellation_token_hash: string | null;
  confirmation_email_sent_at: string | null;
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

function isActiveReservation(reservation: ReservationRow) {
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
    validationStatus: reservation.validation_status,
  };
}

function toEmailData(reservation: ReservationRow) {
  return {
    firstName: reservation.first_name,
    lastName: reservation.last_name,
    email: reservation.email,
    phone: reservation.phone,
    seats: reservation.seats,
    serviceDate: reservation.service_date,
  };
}

function getLastSentAt(reservation: ReservationRow) {
  return reservation.validation_status === 'pending'
    ? reservation.validation_sent_at
    : reservation.confirmation_email_sent_at;
}

function wasRecentlySent(reservation: ReservationRow) {
  const lastSentAt = getLastSentAt(reservation);
  return Boolean(lastSentAt && Date.now() - new Date(lastSentAt).getTime() < RESEND_COOLDOWN_MS);
}

async function findActiveReservation(
  supabase: ReturnType<typeof createClient>,
  serviceDate: string,
  email: string,
) {
  const { data, error } = await supabase
    .from('reservations')
    .select(RESERVATION_SELECT)
    .eq('service_date', serviceDate)
    .eq('email', email)
    .in('validation_status', ['pending', 'confirmed'])
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const reservations = (data || []) as ReservationRow[];
  const expiredReservationIds = reservations
    .filter(
      (reservation) =>
        reservation.validation_status === 'pending' && !isActiveReservation(reservation),
    )
    .map((reservation) => reservation.id);

  if (expiredReservationIds.length > 0) {
    await supabase
      .from('reservations')
      .update({ validation_status: 'expired' })
      .in('id', expiredReservationIds);
  }

  return reservations.find(isActiveReservation) || null;
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
    const payload = await req.json().catch(() => ({}));
    const serviceDate = normalizeString(payload.date);
    const email = normalizeEmail(payload.email);

    if (!serviceDate) {
      return errorResponse('Date manquante.', 400);
    }

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return errorResponse('Email invalide.', 400);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    const reservation = await findActiveReservation(supabase, serviceDate, email);

    if (!reservation) {
      return jsonResponse({
        status: 'not_found',
        message: "Aucune réservation active n'a été trouvée avec cette adresse email.",
      });
    }

    if (wasRecentlySent(reservation)) {
      return jsonResponse({
        status: 'sent',
        message: 'Un email vient déjà d’être envoyé à cette adresse.',
        reservation: reservationPayload(reservation),
      });
    }

    if (reservation.validation_status === 'pending') {
      const token = createToken();
      const tokenHash = await hashToken(token);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + getTokenTtlMinutes() * 60 * 1000).toISOString();
      const validationUrl = `${publicSiteUrl}/validation?token=${encodeURIComponent(token)}`;

      const previousValidationState = {
        validation_token_hash: reservation.validation_token_hash,
        validation_sent_at: reservation.validation_sent_at,
        validation_expires_at: reservation.validation_expires_at,
      };

      const { data: updatedData, error: updateError } = await supabase
        .from('reservations')
        .update({
          validation_token_hash: tokenHash,
          validation_sent_at: now.toISOString(),
          validation_expires_at: expiresAt,
        })
        .eq('id', reservation.id)
        .select(RESERVATION_SELECT)
        .single();

      if (updateError || !updatedData) {
        return errorResponse(updateError?.message || 'Renvoi impossible.', 500);
      }

      const updatedReservation = updatedData as ReservationRow;

      try {
        await sendReservationSummaryEmail(toEmailData(updatedReservation), {
          actionUrl: validationUrl,
          actionLabel: 'Valider ma réservation',
          actionText: 'Votre réservation attend encore validation. Vous pouvez la confirmer ici :',
        });
      } catch (emailError) {
        await supabase
          .from('reservations')
          .update(previousValidationState)
          .eq('id', reservation.id);
        throw emailError;
      }

      return jsonResponse({
        status: 'sent',
        message: 'Le récapitulatif vient d’être renvoyé à cette adresse email.',
        reservation: reservationPayload(updatedReservation),
      });
    }

    const cancellationToken = createToken();
    const cancellationTokenHash = await hashToken(cancellationToken);
    const cancellationUrl = `${publicSiteUrl}/annulation?token=${encodeURIComponent(
      cancellationToken,
    )}`;
    const previousCancellationState = {
      cancellation_token_hash: reservation.cancellation_token_hash,
    };

    const { data: updatedData, error: updateError } = await supabase
      .from('reservations')
      .update({ cancellation_token_hash: cancellationTokenHash })
      .eq('id', reservation.id)
      .select(RESERVATION_SELECT)
      .single();

    if (updateError || !updatedData) {
      return errorResponse(updateError?.message || 'Renvoi impossible.', 500);
    }

    const updatedReservation = updatedData as ReservationRow;

    try {
      await sendReservationSummaryEmail(toEmailData(updatedReservation), {
        actionUrl: cancellationUrl,
        actionLabel: 'Annuler ma réservation',
        actionText: 'Si vous ne pouvez plus venir, vous pouvez annuler votre réservation ici :',
      });
    } catch (emailError) {
      await supabase
        .from('reservations')
        .update(previousCancellationState)
        .eq('id', reservation.id);
      throw emailError;
    }

    await supabase
      .from('reservations')
      .update({ confirmation_email_sent_at: new Date().toISOString() })
      .eq('id', reservation.id);

    return jsonResponse({
      status: 'sent',
      message: 'Le récapitulatif vient d’être renvoyé à cette adresse email.',
      reservation: reservationPayload(updatedReservation),
    });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Erreur inconnue.', 500);
  }
});

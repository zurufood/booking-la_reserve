import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { errorResponse, jsonResponse, textResponse } from '../_shared/http.ts';
import { sendReservationFeedbackEmail } from '../_shared/reservation-email.ts';

type ReservationRow = {
  id: string;
  service_date: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  seats: number;
};

type SendResult = {
  reservationId: string;
  email: string;
};

type SendFailure = SendResult & {
  error: string;
};

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Secret manquant: ${name}`);
  }
  return value;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeDate(value: unknown) {
  const date = String(value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function addDays(date: string, days: number) {
  const nextDate = new Date(`${date}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate.toISOString().slice(0, 10);
}

function getParisTodayISO() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

function isCronSecretValid(req: Request) {
  const expectedSecret = requireEnv('FEEDBACK_EMAIL_CRON_SECRET');
  const providedSecret = req.headers.get('x-cron-secret') || '';

  return providedSecret === expectedSecret;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return textResponse('ok');
  }

  if (req.method !== 'POST') {
    return errorResponse('Méthode non autorisée.', 405);
  }

  try {
    if (!isCronSecretValid(req)) {
      return errorResponse('Secret de cron invalide.', 401);
    }

    const rawPayload = await req.json().catch(() => ({}));
    const payload =
      rawPayload && typeof rawPayload === 'object' ? (rawPayload as Record<string, unknown>) : {};
    const serviceDate = normalizeDate(payload.serviceDate ?? Deno.env.get('FEEDBACK_SERVICE_DATE'));

    if (!serviceDate) {
      return errorResponse('Date de service manquante. Exemple: 2026-07-16.', 400);
    }

    const sendDate = addDays(serviceDate, 1);
    const today = getParisTodayISO();
    const force = payload.force === true;
    const dryRun = payload.dryRun === true;

    if (!force && today < sendDate) {
      return errorResponse(`Relance prévue à partir du ${sendDate}.`, 425);
    }

    const supabaseUrl = requireEnv('SUPABASE_URL');
    const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
    const googleReviewUrl = requireEnv('GOOGLE_REVIEW_URL');
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
      },
    });

    const { data, error } = await supabase
      .from('reservations')
      .select('id, service_date, first_name, last_name, email, phone, seats')
      .eq('service_date', serviceDate)
      .eq('validation_status', 'confirmed')
      .is('feedback_email_sent_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      return errorResponse(error.message, 500);
    }

    const reservations = (data || []) as ReservationRow[];
    const sent: SendResult[] = [];
    const failed: SendFailure[] = [];

    if (!dryRun) {
      for (const reservation of reservations) {
        try {
          await sendReservationFeedbackEmail(
            {
              firstName: reservation.first_name,
              lastName: reservation.last_name,
              email: reservation.email,
              phone: reservation.phone,
              seats: reservation.seats,
              serviceDate: reservation.service_date,
            },
            googleReviewUrl,
          );

          const { error: updateError } = await supabase
            .from('reservations')
            .update({ feedback_email_sent_at: new Date().toISOString() })
            .eq('id', reservation.id)
            .is('feedback_email_sent_at', null);

          if (updateError) {
            throw updateError;
          }

          sent.push({
            reservationId: reservation.id,
            email: reservation.email,
          });
        } catch (sendError) {
          failed.push({
            reservationId: reservation.id,
            email: reservation.email,
            error: getErrorMessage(sendError),
          });
        }
      }
    }

    return jsonResponse({
      serviceDate,
      sendDate,
      dryRun,
      eligibleCount: reservations.length,
      sentCount: sent.length,
      failedCount: failed.length,
      sent,
      failed,
    });
  } catch (error) {
    return errorResponse(getErrorMessage(error), 500);
  }
});

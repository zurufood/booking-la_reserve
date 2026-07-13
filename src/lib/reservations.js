import { NEXT_SERVICE_DATE } from './dates';
import { supabase } from './supabase';

export const validationStatusOptions = [
  { value: 'tous', label: 'Tous' },
  { value: 'pending', label: 'En attente' },
  { value: 'confirmed', label: 'Confirmée' },
  { value: 'expired', label: 'Expirée' },
  { value: 'cancelled', label: 'Annulée' },
];

const validationStatusLabels = {
  pending: 'En attente',
  confirmed: 'Confirmée',
  expired: 'Expirée',
  cancelled: 'Annulée',
};

const reservationSelect = [
  'id',
  'created_at',
  'updated_at',
  'service_date',
  'first_name',
  'last_name',
  'email',
  'phone',
  'seats',
  'validation_status',
  'validation_sent_at',
  'validation_expires_at',
  'confirmed_at',
  'confirmation_email_sent_at',
].join(', ');

export function getEffectiveValidationStatus(reservation) {
  if (
    reservation.validationStatus === 'pending' &&
    reservation.validationExpiresAt &&
    new Date(reservation.validationExpiresAt).getTime() <= Date.now()
  ) {
    return 'expired';
  }

  return reservation.validationStatus || 'confirmed';
}

export function getValidationStatusLabel(status) {
  return validationStatusLabels[status] ?? status;
}

export function isReservationHoldingSeats(reservation) {
  const status = getEffectiveValidationStatus(reservation);
  return status === 'confirmed' || status === 'pending';
}

export function mapReservation(row) {
  const reservation = {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    date: row.service_date,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    email: row.email,
    phone: row.phone,
    seats: Number(row.seats),
    validationStatus: row.validation_status || 'confirmed',
    validationSentAt: row.validation_sent_at,
    validationExpiresAt: row.validation_expires_at,
    confirmedAt: row.confirmed_at,
    confirmationEmailSentAt: row.confirmation_email_sent_at,
  };

  return {
    ...reservation,
    effectiveValidationStatus: getEffectiveValidationStatus(reservation),
  };
}

function toReservationRow(values) {
  const row = {};

  if ('date' in values) row.service_date = values.date;
  if ('firstName' in values) row.first_name = values.firstName.trim();
  if ('lastName' in values) row.last_name = values.lastName.trim();
  if ('email' in values) row.email = values.email.trim().toLowerCase();
  if ('phone' in values) row.phone = values.phone.trim();
  if ('seats' in values) row.seats = Number(values.seats);

  return row;
}

function throwIfError(error) {
  if (error) {
    throw new Error(error.message || 'Une erreur est survenue.');
  }
}

async function getFunctionErrorMessage(error) {
  const response = error?.context;

  if (response && typeof response.clone === 'function') {
    try {
      const body = await response.clone().json();
      if (body?.error) return body.error;
      if (body?.message) return body.message;
    } catch {
      // Fall through to text/error message handling.
    }

    try {
      const text = await response.clone().text();
      if (text) return text;
    } catch {
      // Fall through to the generic error message.
    }
  }

  return error?.message || 'Une erreur est survenue.';
}

export async function fetchPublicAvailability() {
  const { data, error } = await supabase.rpc('get_public_availability', {
    p_start_date: NEXT_SERVICE_DATE,
    p_weeks: 1,
  });

  throwIfError(error);

  return (data || []).map((row) => ({
    date: row.service_date,
    bookedSeats: Number(row.booked_seats),
    remainingSeats: Number(row.remaining_seats),
  }));
}

export async function createPublicReservation({ firstName, lastName, email, phone, seats }) {
  const { data, error } = await supabase.functions.invoke('create-reservation-request', {
    body: {
      date: NEXT_SERVICE_DATE,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      seats: Number(seats),
    },
  });

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data || null;
}

export async function confirmReservation(token) {
  const { data, error } = await supabase.functions.invoke('confirm-reservation', {
    body: { token },
  });

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data || null;
}

export async function resendReservationSummary({ email }) {
  const { data, error } = await supabase.functions.invoke('resend-reservation-summary', {
    body: {
      date: NEXT_SERVICE_DATE,
      email: email.trim().toLowerCase(),
    },
  });

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data || null;
}

export async function previewReservationCancellation(token) {
  const { data, error } = await supabase.functions.invoke('cancel-reservation', {
    body: { token },
  });

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data || null;
}

export async function cancelReservation(token) {
  const { data, error } = await supabase.functions.invoke('cancel-reservation', {
    body: { token, confirm: true },
  });

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }

  if (data?.error) {
    throw new Error(data.error);
  }

  return data || null;
}

export async function fetchReservations() {
  const { data, error } = await supabase
    .from('reservations')
    .select(reservationSelect)
    .order('service_date', { ascending: true })
    .order('created_at', { ascending: true });

  throwIfError(error);

  return (data || []).map(mapReservation);
}

export async function createAdminReservation(values) {
  const { data, error } = await supabase
    .from('reservations')
    .insert({
      ...toReservationRow(values),
      validation_status: 'confirmed',
      validation_token_hash: null,
      validation_sent_at: null,
      validation_expires_at: null,
      confirmed_at: new Date().toISOString(),
      confirmation_email_sent_at: null,
    })
    .select(reservationSelect)
    .single();

  throwIfError(error);

  return mapReservation(data);
}

export async function updateAdminReservation(id, values) {
  const { data, error } = await supabase
    .from('reservations')
    .update(toReservationRow(values))
    .eq('id', id)
    .select(reservationSelect)
    .single();

  throwIfError(error);

  return mapReservation(data);
}

export async function deleteAdminReservation(id) {
  const { error } = await supabase.from('reservations').delete().eq('id', id);
  throwIfError(error);
}

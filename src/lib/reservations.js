import { NEXT_SERVICE_DATE } from './dates';
import { supabase } from './supabase';

export function mapReservation(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    date: row.service_date,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    email: row.email,
    phone: row.phone,
    seats: Number(row.seats),
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
  const { data, error } = await supabase.rpc('create_public_reservation', {
    p_service_date: NEXT_SERVICE_DATE,
    p_first_name: firstName.trim(),
    p_last_name: lastName.trim(),
    p_email: email.trim().toLowerCase(),
    p_phone: phone.trim(),
    p_seats: Number(seats),
  });

  throwIfError(error);

  const reservation = Array.isArray(data) ? data[0] : data;

  return reservation
    ? {
        id: reservation.id,
        serviceDate: reservation.service_date,
        seats: Number(reservation.seats),
        remainingSeats: Number(reservation.remaining_seats),
      }
    : null;
}

export async function fetchReservations() {
  const { data, error } = await supabase
    .from('reservations')
    .select('id, created_at, updated_at, service_date, first_name, last_name, email, phone, seats')
    .order('service_date', { ascending: true })
    .order('created_at', { ascending: true });

  throwIfError(error);

  return (data || []).map(mapReservation);
}

export async function createAdminReservation(values) {
  const { data, error } = await supabase
    .from('reservations')
    .insert(toReservationRow(values))
    .select('id, created_at, updated_at, service_date, first_name, last_name, email, phone, seats')
    .single();

  throwIfError(error);

  return mapReservation(data);
}

export async function updateAdminReservation(id, values) {
  const { data, error } = await supabase
    .from('reservations')
    .update(toReservationRow(values))
    .eq('id', id)
    .select('id, created_at, updated_at, service_date, first_name, last_name, email, phone, seats')
    .single();

  throwIfError(error);

  return mapReservation(data);
}

export async function deleteAdminReservation(id) {
  const { error } = await supabase.from('reservations').delete().eq('id', id);
  throwIfError(error);
}

import { DEPOSIT_PER_SEAT } from './config';
import { getTodayISO } from './dates';
import { supabase } from './supabase';

export const depositOptions = [
  { value: 'a-payer', label: 'Acompte à payer' },
  { value: 'paye', label: 'Acompte payé' },
];

export function getDepositLabel(status) {
  return depositOptions.find((option) => option.value === status)?.label ?? status;
}

export function mapReservation(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    date: row.service_date,
    email: row.email,
    phone: row.phone,
    seats: Number(row.seats),
    depositPerSeat: Number(row.deposit_per_seat),
    depositStatus: row.deposit_status,
  };
}

function toReservationRow(values) {
  const row = {};

  if ('date' in values) row.service_date = values.date;
  if ('email' in values) row.email = values.email.trim().toLowerCase();
  if ('phone' in values) row.phone = values.phone.trim();
  if ('seats' in values) row.seats = Number(values.seats);
  if ('depositPerSeat' in values) row.deposit_per_seat = Number(values.depositPerSeat);
  if ('depositStatus' in values) row.deposit_status = values.depositStatus;

  return row;
}

function throwIfError(error) {
  if (error) {
    throw new Error(error.message || 'Une erreur est survenue.');
  }
}

export async function fetchPublicAvailability() {
  const { data, error } = await supabase.rpc('get_public_availability', {
    p_start_date: getTodayISO(),
    p_weeks: 16,
  });

  throwIfError(error);

  return (data || []).map((row) => ({
    date: row.service_date,
    bookedSeats: Number(row.booked_seats),
    remainingSeats: Number(row.remaining_seats),
  }));
}

export async function createPublicReservation({ date, email, phone, seats }) {
  const { data, error } = await supabase.rpc('create_public_reservation', {
    p_service_date: date,
    p_email: email.trim().toLowerCase(),
    p_phone: phone.trim(),
    p_seats: Number(seats),
    p_deposit_per_seat: DEPOSIT_PER_SEAT,
  });

  throwIfError(error);

  return data?.[0] || null;
}

export async function fetchReservations() {
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .order('service_date', { ascending: true })
    .order('created_at', { ascending: true });

  throwIfError(error);

  return (data || []).map(mapReservation);
}

export async function createAdminReservation(values) {
  const { data, error } = await supabase
    .from('reservations')
    .insert(toReservationRow(values))
    .select('*')
    .single();

  throwIfError(error);

  return mapReservation(data);
}

export async function updateAdminReservation(id, values) {
  const { data, error } = await supabase
    .from('reservations')
    .update(toReservationRow(values))
    .eq('id', id)
    .select('*')
    .single();

  throwIfError(error);

  return mapReservation(data);
}

export async function deleteAdminReservation(id) {
  const { error } = await supabase.from('reservations').delete().eq('id', id);
  throwIfError(error);
}

import { getCheckoutIntent, extractAuthorizedCheckout } from './helloasso.ts';
import {
  sendAdminPaymentConflictEmail,
  sendAdminReservationConfirmedEmail,
  sendReservationConfirmedEmail,
} from './reservation-email.ts';

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function createToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toBase64Url(new Uint8Array(digest));
}

export async function reconcileHelloAssoPayment(
  supabase: any,
  reservationId: string,
  checkoutIntentId: number,
  publicSiteUrl: string,
) {
  const { data: reservation, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('id', reservationId)
    .single();
  if (error || !reservation) throw new Error('Réservation introuvable.');

  if (['paid', 'refund_pending', 'refunded'].includes(reservation.payment_status)) {
    return { status: 'paid', reservation };
  }

  const { data: attempt } = await supabase
    .from('reservation_payment_attempts')
    .select('*')
    .eq('reservation_id', reservationId)
    .eq('checkout_intent_id', checkoutIntentId)
    .maybeSingle();
  if (!attempt) throw new Error('Tentative de paiement inconnue.');

  const checkout = await getCheckoutIntent(supabase, checkoutIntentId);
  const authorized = extractAuthorizedCheckout(checkout);
  if (!authorized) return { status: 'pending', reservation };

  if (authorized.amountCents !== Number(reservation.payment_amount_cents)) {
    const reason = `Montant HelloAsso ${authorized.amountCents} différent du montant attendu ${reservation.payment_amount_cents}.`;
    await supabase.from('reservation_payment_attempts').update({
      status: 'authorized', order_id: authorized.orderId, payment_id: authorized.paymentId,
    }).eq('id', attempt.id);
    await supabase.from('reservations').update({
      payment_status: 'conflict',
      helloasso_order_id: authorized.orderId,
      helloasso_payment_id: authorized.paymentId,
      payment_paid_at: new Date().toISOString(),
      payment_conflict_reason: reason,
    }).eq('id', reservation.id);
    await sendAdminPaymentConflictEmail(reservation, reason).catch(console.error);
    return { status: 'conflict', reservation };
  }

  const cancellationToken = createToken();
  const cancellationTokenHash = await hashToken(cancellationToken);
  const paidAt = new Date().toISOString();
  const { data: confirmed, error: updateError } = await supabase
    .from('reservations')
    .update({
      validation_status: 'confirmed',
      confirmed_at: reservation.confirmed_at || paidAt,
      payment_status: 'paid',
      payment_paid_at: paidAt,
      helloasso_order_id: authorized.orderId,
      helloasso_payment_id: authorized.paymentId,
      cancellation_token_hash: cancellationTokenHash,
      validation_token_hash: null,
      validation_expires_at: null,
      payment_conflict_reason: null,
    })
    .eq('id', reservation.id)
    .eq('payment_status', 'pending')
    .select('*')
    .maybeSingle();

  if (updateError) {
    const reason = `Paiement reçu mais confirmation impossible: ${updateError.message}`;
    await supabase.from('reservations').update({
      payment_status: 'conflict',
      helloasso_order_id: authorized.orderId,
      helloasso_payment_id: authorized.paymentId,
      payment_paid_at: paidAt,
      payment_conflict_reason: reason,
    }).eq('id', reservation.id);
    await sendAdminPaymentConflictEmail(reservation, reason).catch(console.error);
    return { status: 'conflict', reservation };
  }

  await supabase.from('reservation_payment_attempts').update({
    status: 'authorized', order_id: authorized.orderId, payment_id: authorized.paymentId,
  }).eq('id', attempt.id);

  if (!confirmed) return { status: 'paid', reservation };

  const emailData = {
    firstName: confirmed.first_name,
    lastName: confirmed.last_name,
    email: confirmed.email,
    phone: confirmed.phone,
    seats: confirmed.seats,
    serviceDate: confirmed.service_date,
  };
  const cancellationUrl = `${publicSiteUrl}/annulation?token=${encodeURIComponent(cancellationToken)}`;
  let emailSent = false;
  try {
    await sendReservationConfirmedEmail(emailData, cancellationUrl);
    await supabase.from('reservations').update({ confirmation_email_sent_at: new Date().toISOString() }).eq('id', confirmed.id);
    emailSent = true;
  } catch (emailError) {
    console.error(emailError);
  }
  await sendAdminReservationConfirmedEmail(emailData).catch(console.error);
  return { status: 'paid', reservation: confirmed, emailSent };
}

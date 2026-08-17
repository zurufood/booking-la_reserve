import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { errorResponse, jsonResponse, textResponse } from '../_shared/http.ts';
import { calculatePaymentAmountCents } from '../_shared/payment-rules.ts';
import { getHelloAssoSiteUrl } from '../_shared/helloasso.ts';

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret manquant: ${name}`);
  return value;
}

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return textResponse('ok');
  if (req.method !== 'POST') return errorResponse('Méthode non autorisée.', 405);

  try {
    const authorization = req.headers.get('Authorization') || '';
    if (!authorization) return errorResponse('Connexion administrateur requise.', 401);

    const supabaseUrl = requireEnv('SUPABASE_URL');
    const authClient = createClient(supabaseUrl, requireEnv('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) return errorResponse('Session administrateur invalide.', 401);

    const supabase = createClient(supabaseUrl, requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });
    const { data: admin } = await supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (!admin) return errorResponse('Accès administrateur refusé.', 403);

    const payload = await req.json().catch(() => ({}));
    const reservationId = String(payload.reservationId || '').trim();
    if (!reservationId) return errorResponse('Réservation requise.', 400);

    const { data: reservation, error: reservationError } = await supabase
      .from('reservations')
      .select('id, seats, validation_status, payment_status')
      .eq('id', reservationId)
      .single();
    if (reservationError || !reservation) return errorResponse('Réservation introuvable.', 404);
    if (reservation.validation_status !== 'confirmed') {
      return errorResponse('Seule une réservation confirmée peut recevoir un lien de paiement.', 409);
    }
    if (['paid', 'refund_pending', 'refunded', 'conflict'].includes(reservation.payment_status)) {
      return errorResponse('Cette réservation est déjà liée à un paiement.', 409);
    }

    const token = createToken();
    const createdAt = new Date().toISOString();
    const amountCents = calculatePaymentAmountCents(Number(reservation.seats));
    const { error: updateError } = await supabase
      .from('reservations')
      .update({
        payment_link_token_hash: await hashToken(token),
        payment_link_created_at: createdAt,
        payment_amount_cents: amountCents,
      })
      .eq('id', reservation.id);
    if (updateError) throw new Error(updateError.message);

    const paymentUrl = `${getHelloAssoSiteUrl()}/reglement?token=${encodeURIComponent(token)}`;
    return jsonResponse({ paymentUrl, createdAt, amountCents });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Erreur inconnue.', 500);
  }
});

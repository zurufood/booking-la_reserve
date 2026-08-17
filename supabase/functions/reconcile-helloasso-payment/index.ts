import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { errorResponse, jsonResponse, textResponse } from '../_shared/http.ts';
import { reconcileHelloAssoPayment } from '../_shared/helloasso-payment.ts';
import { getHelloAssoSiteUrl } from '../_shared/helloasso.ts';

function requireEnv(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`Secret manquant: ${name}`); return value; }
function toBase64Url(bytes: Uint8Array) { let binary = ''; bytes.forEach((b) => binary += String.fromCharCode(b)); return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
async function hashToken(token: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)); return toBase64Url(new Uint8Array(digest)); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return textResponse('ok');
  if (req.method !== 'POST') return errorResponse('Méthode non autorisée.', 405);
  try {
    const payload = await req.json().catch(() => ({}));
    const token = String(payload.token || '').trim();
    if (!token) return errorResponse('Jeton de retour invalide.', 400);
    const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const { data: reservation } = await supabase.from('reservations').select('*')
      .eq('payment_return_token_hash', await hashToken(token)).maybeSingle();
    if (!reservation) return errorResponse('Paiement introuvable.', 404);
    if (['paid', 'refund_pending', 'refunded'].includes(reservation.payment_status)) {
      return jsonResponse({ status: 'paid', reservation: { serviceDate: reservation.service_date, seats: reservation.seats, amountCents: reservation.payment_amount_cents } });
    }
    if (reservation.payment_status === 'conflict') return jsonResponse({ status: 'conflict' });
    const requestedId = Number(payload.checkoutIntentId);
    let query = supabase.from('reservation_payment_attempts').select('*').eq('reservation_id', reservation.id);
    if (Number.isFinite(requestedId) && requestedId > 0) query = query.eq('checkout_intent_id', requestedId);
    const { data: attempt } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!attempt) return jsonResponse({ status: 'failed', message: 'Tentative de paiement introuvable.' });
    const result = await reconcileHelloAssoPayment(supabase, reservation.id, Number(attempt.checkout_intent_id), getHelloAssoSiteUrl());
    return jsonResponse({
      status: result.status,
      reservation: result.status === 'paid' ? { serviceDate: reservation.service_date, seats: reservation.seats, amountCents: reservation.payment_amount_cents } : undefined,
    });
  } catch (error) { return errorResponse(error instanceof Error ? error.message : 'Erreur inconnue.', 500); }
});

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';
import { errorResponse, jsonResponse, textResponse } from '../_shared/http.ts';
import { reconcileHelloAssoPayment } from '../_shared/helloasso-payment.ts';
import { getHelloAssoSiteUrl } from '../_shared/helloasso.ts';

function requireEnv(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`Secret manquant: ${name}`); return value; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return textResponse('ok');
  if (req.method !== 'POST') return errorResponse('Méthode non autorisée.', 405);
  try {
    const payload = await req.json().catch(() => ({}));
    if (!['Payment', 'Order'].includes(String(payload.eventType || ''))) return jsonResponse({ received: true });
    const reservationId = String(payload.metadata?.reservationId || '').trim();
    if (!reservationId) return jsonResponse({ received: true });
    const supabase = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const { data: attempts } = await supabase.from('reservation_payment_attempts').select('checkout_intent_id')
      .eq('reservation_id', reservationId).order('created_at', { ascending: false }).limit(5);
    for (const attempt of attempts || []) {
      const result = await reconcileHelloAssoPayment(supabase, reservationId, Number(attempt.checkout_intent_id), getHelloAssoSiteUrl());
      if (result.status !== 'pending') break;
    }
    return jsonResponse({ received: true });
  } catch (error) {
    console.error(error);
    return errorResponse(error instanceof Error ? error.message : 'Erreur inconnue.', 500);
  }
});

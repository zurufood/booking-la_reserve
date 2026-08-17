const TOKEN_EARLY_REFRESH_MS = 60_000;

function requireEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret manquant: ${name}`);
  return value;
}

function getHosts() {
  const environment = (Deno.env.get('HELLOASSO_ENVIRONMENT') || 'sandbox').toLowerCase();
  const sandbox = environment !== 'production';
  return {
    authUrl: sandbox
      ? 'https://api.helloasso-sandbox.com/oauth2/token'
      : 'https://api.helloasso.com/oauth2/token',
    apiUrl: sandbox
      ? 'https://api.helloasso-sandbox.com/v5'
      : 'https://api.helloasso.com/v5',
  };
}

function isAccessTokenForApi(accessToken: string, apiUrl: string) {
  try {
    const payloadPart = accessToken.split('.')[1];
    if (!payloadPart) return false;
    const normalized = payloadPart.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    const issuer = String(payload.iss || '').replace(/\/$/, '');
    return issuer === apiUrl.replace(/\/v5$/, '');
  } catch {
    return false;
  }
}

async function requestTokens(parameters: URLSearchParams) {
  const { authUrl } = getHosts();
  const response = await fetch(authUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'ZuruZuru-Reservation/1.0 (+https://lareserve.zuruzuru.fr)',
    },
    body: parameters,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token || !body.refresh_token) {
    throw new Error(`Authentification HelloAsso impossible: ${body.error_description || body.error || response.statusText}`);
  }
  return body as { access_token: string; refresh_token: string; expires_in?: number };
}

export async function getHelloAssoAccessToken(supabase: any) {
  const { apiUrl } = getHosts();
  const { data } = await supabase
    .from('helloasso_oauth_tokens')
    .select('access_token, refresh_token, access_token_expires_at')
    .eq('singleton', true)
    .maybeSingle();

  if (
    data?.access_token &&
    isAccessTokenForApi(data.access_token, apiUrl) &&
    new Date(data.access_token_expires_at).getTime() > Date.now() + TOKEN_EARLY_REFRESH_MS
  ) {
    return data.access_token as string;
  }

  let tokens;
  if (data?.refresh_token) {
    try {
      tokens = await requestTokens(
        new URLSearchParams({ grant_type: 'refresh_token', refresh_token: data.refresh_token }),
      );
    } catch {
      tokens = null;
    }
  }

  if (!tokens) {
    tokens = await requestTokens(
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: requireEnv('HELLOASSO_CLIENT_ID'),
        client_secret: requireEnv('HELLOASSO_CLIENT_SECRET'),
      }),
    );
  }

  const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 1800) * 1000).toISOString();
  const { error } = await supabase.from('helloasso_oauth_tokens').upsert({
    singleton: true,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Jeton HelloAsso non sauvegardé: ${error.message}`);
  return tokens.access_token;
}

export async function helloAssoRequest(supabase: any, path: string, init: RequestInit = {}) {
  const accessToken = await getHelloAssoAccessToken(supabase);
  const { apiUrl } = getHosts();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'ZuruZuru-Reservation/1.0 (+https://lareserve.zuruzuru.fr)',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.errors?.map((item: any) => item.message).filter(Boolean).join(', ');
    throw new Error(`HelloAsso: ${detail || body?.message || response.statusText}`);
  }
  return body;
}

export function getOrganizationSlug() {
  return encodeURIComponent(requireEnv('HELLOASSO_ORGANIZATION_SLUG'));
}

export function getHelloAssoSiteUrl() {
  return (Deno.env.get('HELLOASSO_RETURN_SITE_URL') || requireEnv('PUBLIC_SITE_URL')).replace(/\/$/, '');
}

export async function createCheckoutIntent(supabase: any, payload: Record<string, unknown>) {
  return await helloAssoRequest(
    supabase,
    `/organizations/${getOrganizationSlug()}/checkout-intents`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function getCheckoutIntent(supabase: any, checkoutIntentId: number) {
  return await helloAssoRequest(
    supabase,
    `/organizations/${getOrganizationSlug()}/checkout-intents/${checkoutIntentId}`,
  );
}

function findPaymentNode(value: unknown): any | null {
  if (!value || typeof value !== 'object') return null;
  const node = value as Record<string, any>;
  if (
    String(node.state || '').toLowerCase() === 'authorized' &&
    Number.isFinite(Number(node.id)) &&
    Number.isFinite(Number(node.amount)) &&
    ('paymentMeans' in node || 'cashOutState' in node || 'installmentNumber' in node)
  ) return node;
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findPaymentNode(item);
        if (found) return found;
      }
    } else if (child && typeof child === 'object') {
      const found = findPaymentNode(child);
      if (found) return found;
    }
  }
  return null;
}

export function extractAuthorizedCheckout(checkout: any) {
  const payment = findPaymentNode(checkout);
  if (!checkout?.order || !payment) return null;
  return {
    orderId: Number(checkout.order.id),
    paymentId: Number(payment.id),
    amountCents: Number(payment.amount),
  };
}

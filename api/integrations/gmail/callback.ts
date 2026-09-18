import crypto from 'crypto';

export const config = { runtime: 'nodejs' };

const sqlText = (value: string) => "'" + String(value).split("'").join("''") + "'";

async function query(sql: string) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) throw new Error('Supabase is not configured.');
  const response = await fetch('https://api.supabase.com/v1/projects/' + encodeURIComponent(ref) + '/database/query', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: String(sql), parameters: [], read_only: false }),
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error('Supabase query failed (' + response.status + '): ' + String(data?.message || data?.error || data?.details || text).slice(0, 300));
  return data?.result ?? data?.data ?? data;
}

function key() {
  const value = process.env.THEOPHANY_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error('A server-side token encryption secret is not configured.');
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function b64url(data: Buffer) {
  return data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return 'v2:' + b64url(iv) + ':' + b64url(cipher.getAuthTag()) + ':' + b64url(ciphertext);
}

function uuid() { return crypto.randomUUID(); }

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  try {
    const code = String(req.query?.code || '').trim();
    const state = String(req.query?.state || '').trim();
    const error = String(req.query?.error || '').trim();
    if (error) return res.redirect('/?integration=gmail&status=denied&reason=' + encodeURIComponent(error));
    if (!code || !state) return res.status(400).json({ ok: false, message: 'Missing OAuth code or state.' });

    const rows: any = await query('delete from public.theophany_oauth_states where state=' + sqlText(state) + " and provider='gmail' and expires_at>now() returning session_id;");
    const sessionId = Array.isArray(rows) ? rows[0]?.session_id : null;
    if (!sessionId) throw new Error('OAuth state is invalid or expired.');

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Gmail OAuth credentials are not configured.');

    const redirectUri = 'https://theophany.vercel.app/api/integrations/gmail/callback';
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || 'Google token exchange failed.');

    const expiresAt = new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString();
    const access = encrypt(token.access_token);
    const refresh = token.refresh_token ? encrypt(token.refresh_token) : null;
    const scopes = sqlText('{' + String(token.scope || '').split(' ').filter(Boolean).map((s: string) => s.replace(/[{}",\\]/g, '')).join(',') + '}');
    const metadata = sqlText(JSON.stringify({ token_type: token.token_type || 'Bearer' }));
    await query(
      'insert into public.theophany_integrations(id,session_id,provider,status,access_token,refresh_token,expires_at,scopes,metadata) values (' +
      sqlText(uuid()) + ',' + sqlText(sessionId) + ",'gmail','connected'," + sqlText(access) + ',' +
      (refresh ? sqlText(refresh) : 'null') + ',' + sqlText(expiresAt) + ',' + scopes + '::text[],' + metadata +
      "::jsonb) on conflict(session_id,provider) do update set status='connected',access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,scopes=excluded.scopes,metadata=excluded.metadata,updated_at=now();"
    );
    return res.redirect('/?integration=gmail&status=connected');
  } catch (error: any) {
    console.error('THEOPHANY_GMAIL_CALLBACK_ERROR', error);
    return res.redirect('/?integration=gmail&status=error&reason=' + encodeURIComponent(error?.message || 'OAuth failed'));
  }
}

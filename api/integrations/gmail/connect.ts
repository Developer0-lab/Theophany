export const config = { runtime: 'nodejs' };

const sqlText = (value: string) => "'" + String(value).split("'").join("''") + "'";

async function query(sql: string) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) throw new Error('Supabase is not configured.');
  const response = await fetch('https://api.supabase.com/v1/projects/' + encodeURIComponent(ref) + '/database/query', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error('Supabase query failed (' + response.status + '): ' + String(data?.message || data?.error || data?.details || text).slice(0, 300));
  return data?.result ?? data?.data ?? data;
}

function randomHex(bytes: number) {
  const data = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(data);
  return Array.from(data, b => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  try {
    const sessionId = String(req.query?.session_id || '').trim();
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!sessionId) return res.status(400).json({ ok: false, message: 'session_id is required.' });
    if (!clientId) return res.status(503).json({ ok: false, message: 'Gmail is not configured yet. Add GOOGLE_CLIENT_ID.' });
    const state = randomHex(32);
    await query('insert into public.theophany_oauth_states(state,session_id,provider,expires_at) values (' + sqlText(state) + ',' + sqlText(sessionId) + ',' + sqlText('gmail') + ",now()+interval '10 minutes');");
    const origin = (req.headers?.['x-forwarded-proto'] || 'https') + '://' + (req.headers?.host || 'theophany.vercel.app');
    const redirectUri = origin + '/api/integrations/gmail/callback';
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: 'openid email https://www.googleapis.com/auth/gmail.modify',
      state,
    });
    return res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
  } catch (error: any) {
    console.error('THEOPHANY_GMAIL_CONNECT_ERROR', error);
    return res.status(500).json({ ok: false, message: error?.message || 'Could not start Gmail OAuth.' });
  }
}

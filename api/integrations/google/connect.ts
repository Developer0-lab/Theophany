export const config = { runtime: 'nodejs' };

const scopes: Record<string,string> = {
  'google-drive': 'openid email https://www.googleapis.com/auth/drive',
  'google-calendar': 'openid email https://www.googleapis.com/auth/calendar',
};

async function query(sql: string) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) throw new Error('Supabase is not configured.');
  const response = await fetch('https://api.supabase.com/v1/projects/' + encodeURIComponent(ref) + '/database/query', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: String(sql), parameters: [], read_only: false }) });
  const body = await response.text();
  if (!response.ok) throw new Error('Supabase query failed (' + response.status + '): ' + body.slice(0, 300));
  const data: any = body ? JSON.parse(body) : {};
  return data?.result ?? data?.data ?? data;
}

function sqlText(value: string) { return "'" + String(value).replace(/'/g, "''") + "'"; }

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  try {
    const sessionId = String(req.query?.session_id || '').trim();
    const provider = String(req.query?.provider || '').trim();
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!sessionId) return res.status(400).json({ ok: false, message: 'session_id is required.' });
    if (!scopes[provider]) return res.status(400).json({ ok: false, message: 'Unsupported Google integration.' });
    if (!clientId) return res.status(503).json({ ok: false, message: 'Google integration is not configured yet. Add GOOGLE_CLIENT_ID.' });
    const crypto: any = await import('crypto');
    const state = crypto.randomBytes(32).toString('hex');
    await query('insert into public.theophany_oauth_states(state,session_id,provider,expires_at) values (' + sqlText(state) + ',' + sqlText(sessionId) + ',' + sqlText(provider) + ",now()+interval '10 minutes');");
    const origin = (req.headers?.['x-forwarded-proto'] || 'https') + '://' + (req.headers?.host || 'theophany.vercel.app');
    const redirectUri = origin + '/api/integrations/google/callback';
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: scopes[provider], state });
    return res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
  } catch (error: any) {
    console.error('THEOPHANY_GOOGLE_CONNECT_ERROR', error);
    return res.status(500).json({ ok: false, message: error?.message || 'Could not start Google OAuth.' });
  }
}

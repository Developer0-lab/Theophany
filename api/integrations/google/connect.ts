import { saveOAuthState } from '../../../lib/integrations/oauth';

export const config = { runtime: 'nodejs' };

const scopes: Record<string,string> = {
  'google-drive': 'openid email https://www.googleapis.com/auth/drive',
  'google-calendar': 'openid email https://www.googleapis.com/auth/calendar',
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  try {
    const sessionId = String(req.query?.session_id || '').trim();
    const provider = String(req.query?.provider || '').trim();
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!sessionId) return res.status(400).json({ ok: false, message: 'session_id is required.' });
    if (!scopes[provider]) return res.status(400).json({ ok: false, message: 'Unsupported Google integration.' });
    if (!clientId) return res.status(503).json({ ok: false, message: 'Google integration is not configured yet. Add GOOGLE_CLIENT_ID.' });
    const state = await saveOAuthState(sessionId, provider);
    const origin = (req.headers?.['x-forwarded-proto'] || 'https') + '://' + (req.headers?.host || 'theophany.vercel.app');
    const redirectUri = origin + '/api/integrations/google/callback';
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: scopes[provider], state });
    return res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
  } catch (error: any) {
    console.error('THEOPHANY_GOOGLE_CONNECT_ERROR', error);
    return res.status(500).json({ ok: false, message: error?.message || 'Could not start Google OAuth.' });
  }
}

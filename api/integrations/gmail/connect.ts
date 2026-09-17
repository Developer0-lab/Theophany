import { saveOAuthState } from '../../../lib/integrations/oauth';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  try {
    const sessionId = String(req.query?.session_id || '').trim();
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!sessionId) return res.status(400).json({ ok: false, message: 'session_id is required.' });
    if (!clientId) return res.status(503).json({ ok: false, message: 'Gmail is not configured yet. Add GOOGLE_CLIENT_ID.' });
    const origin = `${req.headers?.['x-forwarded-proto'] || 'https'}://${req.headers?.host || 'theophany.vercel.app'}`;
    const redirectUri = `${origin}/api/integrations/gmail/callback`;
    const state = await saveOAuthState(sessionId, 'gmail');
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: 'openid email https://www.googleapis.com/auth/gmail.modify', state });
    return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  } catch (error: any) { return res.status(500).json({ ok: false, message: error?.message || 'Could not start Gmail OAuth.' }); }
}

import { consumeOAuthStateAny, saveIntegration } from '../../../../lib/integrations/oauth';

export const config = { runtime: 'nodejs' };

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  try {
    const code = String(req.query?.code || '').trim();
    const state = String(req.query?.state || '').trim();
    const error = String(req.query?.error || '').trim();
    if (error) return res.redirect('/?integration=google&status=denied&reason=' + encodeURIComponent(error));
    if (!code || !state) return res.status(400).json({ ok: false, message: 'Missing OAuth code or state.' });
    const oauth = await consumeOAuthStateAny(state);
    if (oauth.provider !== 'google-drive' && oauth.provider !== 'google-calendar') throw new Error('Unsupported Google OAuth provider.');
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('Google OAuth credentials are not configured.');
    const origin = (req.headers?.['x-forwarded-proto'] || 'https') + '://' + (req.headers?.host || 'theophany.vercel.app');
    const redirectUri = origin + '/api/integrations/google/callback';
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || !token.access_token) throw new Error(token.error_description || 'Google token exchange failed.');
    const expiresAt = new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString();
    await saveIntegration(oauth.sessionId, oauth.provider, { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt, scopes: String(token.scope || '').split(' ').filter(Boolean), metadata: { token_type: token.token_type || 'Bearer' } });
    return res.redirect('/?integration=' + oauth.provider + '&status=connected');
  } catch (error: any) {
    console.error('THEOPHANY_GOOGLE_CALLBACK_ERROR', error);
    return res.redirect('/?integration=google&status=error&reason=' + encodeURIComponent(error?.message || 'OAuth failed'));
  }
}

import { consumeOAuthState, saveIntegration } from '../../../lib/integrations/oauth';

export const config = { runtime: 'nodejs' };

const redirectUri = 'https://theophany.vercel.app/api/integrations/tiktok/callback';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  try {
    const code = String(req.query?.code || '');
    const state = String(req.query?.state || '');
    const error = String(req.query?.error || '');
    if (error) return res.redirect('/?integration=tiktok&status=denied&reason=' + encodeURIComponent(error));
    if (!code || !state) throw new Error('TikTok OAuth callback is missing code or state.');

    const { sessionId } = await consumeOAuthState(state, 'tiktok');
    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: process.env.TIKTOK_CLIENT_KEY || '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const token = await response.json();
    if (!response.ok || !token.access_token) {
      throw new Error(token.error_description || token.error || 'TikTok token exchange failed.');
    }

    const scopes = String(token.scope || '').split(/[ ,]/).map((value: string) => value.trim()).filter(Boolean);
    await saveIntegration(sessionId, 'tiktok', {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : undefined,
      scopes,
      metadata: {
        token_type: token.token_type || 'Bearer',
        open_id: token.open_id,
      },
    });

    return res.redirect('/?integration=tiktok&status=connected');
  } catch (error: any) {
    console.error('THEOPHANY_TIKTOK_CALLBACK_ERROR', error);
    return res.redirect('/?integration=tiktok&status=error&reason=' + encodeURIComponent(error?.message || 'TikTok connection failed.'));
  }
}

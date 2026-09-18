import { consumeOAuthStateAny, getIntegrationStatuses, saveIntegration, saveOAuthState } from '../../lib/integrations/oauth';

export const config = { runtime: 'nodejs' };

const REDIRECT = 'https://theophany.vercel.app/api/integrations/status?action=callback';

const configs: Record<string, any> = {
  instagram: { kind:'meta', scope:'pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish,business_management' },
  facebook: { kind:'meta', scope:'pages_show_list,pages_read_engagement,pages_manage_posts,business_management' },
  whatsapp: { kind:'meta', scope:'business_management,whatsapp_business_management,whatsapp_business_messaging' },
  tiktok: { kind:'tiktok', scope:'user.info.basic,video.list,video.publish' },
  notion: { kind:'notion' },
  canva: { kind:'canva', scope:'design:read,design:write,asset:read,asset:write,profile:read' }
};

function missing(envs: string[]) { return envs.filter(name => !process.env[name]); }

async function start(req: any, res: any) {
  const sessionId = String(req.query?.session_id || '').trim();
  const provider = String(req.query?.provider || '').trim();
  if (!sessionId) return res.status(400).json({ ok:false, message:'session_id is required.' });
  const cfg = configs[provider];
  if (!cfg) return res.status(400).json({ ok:false, message:'Unsupported integration.' });

  if (cfg.kind === 'meta') {
    const miss = missing(['META_CLIENT_ID','META_CLIENT_SECRET']);
    if (miss.length) return res.status(503).json({ ok:false, setup_required:true, message:'Meta credentials are not configured: ' + miss.join(', ') });
    const state = await saveOAuthState(sessionId, provider);
    const params = new URLSearchParams({ client_id:process.env.META_CLIENT_ID!, redirect_uri:REDIRECT, response_type:'code', state, scope:cfg.scope });
    return res.redirect('https://www.facebook.com/v23.0/dialog/oauth?' + params.toString());
  }

  if (cfg.kind === 'tiktok') {
    const miss = missing(['TIKTOK_CLIENT_KEY','TIKTOK_CLIENT_SECRET']);
    if (miss.length) return res.status(503).json({ ok:false, setup_required:true, message:'TikTok credentials are not configured: ' + miss.join(', ') });
    const state = await saveOAuthState(sessionId, provider);
    const params = new URLSearchParams({ client_key:process.env.TIKTOK_CLIENT_KEY!, response_type:'code', scope:cfg.scope, redirect_uri:REDIRECT, state });
    return res.redirect('https://www.tiktok.com/v2/auth/authorize/?' + params.toString());
  }

  if (cfg.kind === 'notion') {
    const miss = missing(['NOTION_CLIENT_ID','NOTION_CLIENT_SECRET']);
    if (miss.length) return res.status(503).json({ ok:false, setup_required:true, message:'Notion credentials are not configured: ' + miss.join(', ') });
    const state = await saveOAuthState(sessionId, provider);
    const params = new URLSearchParams({ client_id:process.env.NOTION_CLIENT_ID!, response_type:'code', owner:'user', redirect_uri:REDIRECT, state });
    return res.redirect('https://api.notion.com/v1/oauth/authorize?' + params.toString());
  }

  const miss = missing(['CANVA_CLIENT_ID','CANVA_CLIENT_SECRET']);
  if (miss.length) return res.status(503).json({ ok:false, setup_required:true, message:'Canva credentials are not configured: ' + miss.join(', ') });
  const verifier = require('crypto').randomBytes(64).toString('base64url');
  const challenge = require('crypto').createHash('sha256').update(verifier).digest('base64url');
  const state = await saveOAuthState(sessionId, provider, { code_verifier: verifier });
  const params = new URLSearchParams({ code_challenge:challenge, code_challenge_method:'s256', scope:cfg.scope, response_type:'code', client_id:process.env.CANVA_CLIENT_ID!, state, redirect_uri:REDIRECT });
  return res.redirect('https://www.canva.com/api/oauth/authorize?' + params.toString());
}

async function callback(req: any, res: any) {
  const state = String(req.query?.state || '').trim();
  const code = String(req.query?.code || '').trim();
  const error = String(req.query?.error || '').trim();
  if (error) return res.redirect('/?integration=oauth&status=denied&reason=' + encodeURIComponent(error));
  if (!state || !code) return res.status(400).json({ ok:false, message:'Missing OAuth code or state.' });

  const { sessionId, provider, metadata } = await consumeOAuthStateAny(state);
  let token:any = {};
  let scopes:string[] = [];

  if (provider === 'instagram' || provider === 'facebook' || provider === 'whatsapp') {
    const response = await fetch('https://graph.facebook.com/v23.0/oauth/access_token', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ client_id:process.env.META_CLIENT_ID!, client_secret:process.env.META_CLIENT_SECRET!, redirect_uri:REDIRECT, code }) });
    token = await response.json();
    if (!response.ok || !token.access_token) throw new Error(token.error?.message || 'Meta token exchange failed.');
  } else if (provider === 'tiktok') {
    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method:'POST', headers:{'content-type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ client_key:process.env.TIKTOK_CLIENT_KEY!, client_secret:process.env.TIKTOK_CLIENT_SECRET!, code, grant_type:'authorization_code', redirect_uri:REDIRECT }) });
    token = await response.json();
    if (!response.ok || !token.access_token) throw new Error(token.error_description || token.error || 'TikTok token exchange failed.');
  } else if (provider === 'notion') {
    const credentials = Buffer.from(process.env.NOTION_CLIENT_ID! + ':' + process.env.NOTION_CLIENT_SECRET!).toString('base64');
    const response = await fetch('https://api.notion.com/v1/oauth/token', { method:'POST', headers:{ Authorization:'Basic ' + credentials, 'Content-Type':'application/json' }, body:JSON.stringify({ grant_type:'authorization_code', code, redirect_uri:REDIRECT }) });
    token = await response.json();
    if (!response.ok || !token.access_token) throw new Error(token.error || token.message || 'Notion token exchange failed.');
  } else if (provider === 'canva') {
    const credentials = Buffer.from(process.env.CANVA_CLIENT_ID! + ':' + process.env.CANVA_CLIENT_SECRET!).toString('base64');
    const response = await fetch('https://api.canva.com/rest/v1/oauth/token', { method:'POST', headers:{ Authorization:'Basic ' + credentials, 'Content-Type':'application/x-www-form-urlencoded' }, body:new URLSearchParams({ grant_type:'authorization_code', code_verifier:String(metadata?.code_verifier || ''), code, redirect_uri:REDIRECT }) });
    token = await response.json();
    if (!response.ok || !token.access_token) throw new Error(token.error || token.message || 'Canva token exchange failed.');
  }

  scopes = String(token.scope || '').split(/[ ,]/).filter(Boolean);
  const expiresAt = token.expires_in ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : undefined;
  await saveIntegration(sessionId, provider, { accessToken:token.access_token, refreshToken:token.refresh_token, expiresAt, scopes, metadata:{ token_type:token.token_type || 'Bearer', open_id:token.open_id, bot_id:token.bot_id, workspace_name:token.workspace_name } });
  return res.redirect('/?integration=' + encodeURIComponent(provider) + '&status=connected');
}

export default async function handler(req:any,res:any) {
  if (req.method !== 'GET') return res.status(405).json({ ok:false, message:'Method not allowed' });
  try {
    if (String(req.query?.action || '') === 'connect') return await start(req,res);
    if (String(req.query?.action || '') === 'callback') return await callback(req,res);
    const sessionId = String(req.query?.session_id || '').trim();
    if (!sessionId) return res.status(400).json({ ok:false, message:'session_id is required.' });
    const integrations = await getIntegrationStatuses(sessionId);
    if (process.env.STRIPE_SECRET_KEY && !integrations.some((item:any) => item.provider === 'stripe')) integrations.push({ provider:'stripe', status:'connected', scopes:[], metadata:{ mode:'server' } });
    return res.status(200).json({ ok:true, integrations });
  } catch (error:any) {
    console.error('THEOPHANY_INTEGRATION_STATUS_ERROR', error);
    return res.status(503).json({ ok:false, integrations:[], setup_required:true, message:error?.message || 'Integration service is not ready.' });
  }
}

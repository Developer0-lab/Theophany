export type IntegrationCheckResult = { ok: boolean; message: string };
export type IntegrationDefinition = {
  id: string;
  name: string;
  category?: string;
  configured: () => boolean;
  check: () => Promise<IntegrationCheckResult>;
};

async function checkOpenAI(): Promise<IntegrationCheckResult> {
  if (!process.env.OPENAI_API_KEY) return { ok: false, message: 'OPENAI_API_KEY is not configured.' };
  const model = process.env.THEOPHANY_MODEL || 'gpt-5.4-mini';
  const r = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input: 'Reply with exactly OK.', max_output_tokens: 16 }) });
  if (!r.ok) { const detail = await r.text().catch(() => ''); return { ok: false, message: `OpenAI returned HTTP ${r.status}${detail ? `: ${detail.slice(0, 180)}` : '.'}` }; }
  return { ok: true, message: `OpenAI accepted a live test request using ${model}.` };
}

async function checkGitHub(): Promise<IntegrationCheckResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, message: 'GITHUB_TOKEN is not configured.' };
  const repo = process.env.THEOPHANY_GITHUB_REPO || 'Developer0-lab/Theophany';
  const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
  if (!r.ok) return { ok: false, message: `GitHub returned HTTP ${r.status}.` };
  const data: any = await r.json();
  return { ok: true, message: `GitHub access confirmed for ${data.full_name}.` };
}

async function checkSupabase(): Promise<IntegrationCheckResult> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) return { ok: false, message: 'SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF is not configured.' };
  const r = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!r.ok) return { ok: false, message: `Supabase Management API returned HTTP ${r.status}.` };
  const data: any = await r.json();
  return { ok: true, message: `Supabase access confirmed for ${data.name || ref}.` };
}

async function checkVercel(): Promise<IntegrationCheckResult> {
  if (process.env.VERCEL_TOKEN) {
    const r = await fetch('https://api.vercel.com/v9/user', { headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` } });
    if (!r.ok) return { ok: false, message: `Vercel returned HTTP ${r.status}.` };
    return { ok: true, message: 'Vercel API access confirmed.' };
  }
  if (process.env.VERCEL === '1' || process.env.VERCEL_URL) return { ok: true, message: 'Running inside Vercel; deployment environment confirmed.' };
  return { ok: false, message: 'VERCEL_TOKEN is not configured and this request is not running in Vercel.' };
}

async function checkPesaPal(): Promise<IntegrationCheckResult> {
  const key = process.env.PESAPAL_CONSUMER_KEY;
  const secret = process.env.PESAPAL_CONSUMER_SECRET;
  if (!key || !secret) return { ok: false, message: 'PesaPal credentials are not configured.' };
  const sandbox = process.env.PESAPAL_ENV !== 'live';
  const base = sandbox ? 'https://cybqa.pesapal.com/pesapalv3' : 'https://pay.pesapal.com/v3';
  const r = await fetch(base + '/api/Auth/RequestToken', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ consumer_key: key, consumer_secret: secret }) });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok || !data.token) return { ok: false, message: data.message || data.error?.message || `PesaPal returned HTTP ${r.status}.` };
  return { ok: true, message: `PesaPal ${sandbox ? 'sandbox' : 'live'} authentication confirmed.` };
}

export const integrationRegistry: IntegrationDefinition[] = [
  { id: 'openai', name: 'OpenAI', category: 'AI', configured: () => Boolean(process.env.OPENAI_API_KEY), check: checkOpenAI },
  { id: 'github', name: 'GitHub', category: 'Development', configured: () => Boolean(process.env.GITHUB_TOKEN), check: checkGitHub },
  { id: 'supabase', name: 'Supabase', category: 'Database', configured: () => Boolean(process.env.SUPABASE_ACCESS_TOKEN && process.env.SUPABASE_PROJECT_REF), check: checkSupabase },
  { id: 'vercel', name: 'Vercel', category: 'Deployment', configured: () => Boolean(process.env.VERCEL_TOKEN || process.env.VERCEL === '1' || process.env.VERCEL_URL), check: checkVercel },
  { id: 'pesapal', name: 'PesaPal', category: 'Payments', configured: () => Boolean(process.env.PESAPAL_CONSUMER_KEY && process.env.PESAPAL_CONSUMER_SECRET), check: checkPesaPal },
];

export function configuredIntegrations() {
  return Object.fromEntries(integrationRegistry.map(i => [i.id, i.configured()]));
}

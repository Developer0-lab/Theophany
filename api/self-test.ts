type Stage = { name: string; message: string; ok: boolean };

const json = (res: any, status: number, body: any) => res.status(status).json(body);

async function checkOpenAI() {
  if (!process.env.OPENAI_API_KEY) return { ok: false, message: 'OPENAI_API_KEY is not configured.' };
  const r = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.THEOPHANY_MODEL || 'gpt-5.6-mini', input: 'Reply with exactly OK.', max_output_tokens: 5 }) });
  if (!r.ok) return { ok: false, message: `OpenAI returned HTTP ${r.status}.` };
  return { ok: true, message: 'OpenAI accepted a live test request.' };
}

async function checkGitHub() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, message: 'GITHUB_TOKEN is not configured.' };
  const repo = process.env.THEOPHANY_GITHUB_REPO || 'Developer0-lab/Theophany';
  const r = await fetch(`https://api.github.com/repos/${repo}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
  if (!r.ok) return { ok: false, message: `GitHub returned HTTP ${r.status}.` };
  const data: any = await r.json();
  return { ok: true, message: `GitHub access confirmed for ${data.full_name}.` };
}

async function checkSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, message: 'Supabase credentials are not configured.' };
  const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!(r.ok || r.status === 404)) return { ok: false, message: `Supabase returned HTTP ${r.status}.` };
  return { ok: true, message: 'Supabase accepted an authenticated request.' };
}

async function checkVercel() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { ok: false, message: 'VERCEL_TOKEN is not configured.' };
  const r = await fetch('https://api.vercel.com/v9/user', { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { ok: false, message: `Vercel returned HTTP ${r.status}.` };
  return { ok: true, message: 'Vercel API access confirmed.' };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return json(res, 405, { ok: false, message: 'Method not allowed' });
  const stages: Stage[] = [];
  const checks: Array<[string, () => Promise<{ ok: boolean; message: string }>]> = [['OpenAI', checkOpenAI], ['GitHub', checkGitHub], ['Supabase', checkSupabase], ['Vercel', checkVercel]];
  for (const [name, check] of checks) {
    try { const result = await check(); stages.push({ name, message: result.message, ok: result.ok }); } catch (error: any) { stages.push({ name, message: error?.message || 'Connection check failed.', ok: false }); }
  }
  const passed = stages.filter(s => s.ok).length;
  return json(res, 200, { ok: passed === stages.length, passed, total: stages.length, stages });
}

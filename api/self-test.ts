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
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) return { ok: false, message: 'SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF is not configured.' };
  const r = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!r.ok) return { ok: false, message: `Supabase Management API returned HTTP ${r.status}.` };
  const data: any = await r.json();
  return { ok: true, message: `Supabase access confirmed for ${data.name || ref}.` };
}

async function checkVercel() {
  if (process.env.VERCEL_TOKEN) {
    const r = await fetch('https://api.vercel.com/v9/user', { headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` } });
    if (!r.ok) return { ok: false, message: `Vercel returned HTTP ${r.status}.` };
    return { ok: true, message: 'Vercel API access confirmed.' };
  }
  if (process.env.VERCEL === '1' || process.env.VERCEL_URL) return { ok: true, message: 'Running inside Vercel; deployment environment confirmed.' };
  return { ok: false, message: 'VERCEL_TOKEN is not configured and this request is not running in Vercel.' };
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

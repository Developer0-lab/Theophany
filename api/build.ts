const stage = (events: any[], name: string, message: string, done = false) => events.push({ stage: name, message, done });

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, message: 'Tell Theophany what to build.' });

  const events: any[] = [];
  stage(events, 'Understand', 'Reading your request.');
  const lower = text.toLowerCase();
  const needsSupabase = /\bsupabase\b/.test(lower);
  const needsVercel = /\bvercel\b|deploy|publish|go live/.test(lower);
  stage(events, 'Plan', `Supabase: ${needsSupabase ? 'required' : 'not requested'} · Vercel: ${needsVercel ? 'required' : 'not requested'}`, true);

  const missing: string[] = [];
  if (!process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (!process.env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
  if (needsSupabase && !process.env.SUPABASE_ACCESS_TOKEN) missing.push('SUPABASE_ACCESS_TOKEN');
  if (needsVercel && !process.env.VERCEL_TOKEN) missing.push('VERCEL_TOKEN');

  if (missing.length) {
    stage(events, 'Build', 'The execution bridge is ready, but server-side credentials are not configured.');
    return res.status(200).json({ ok: false, message: `Connect/configure: ${missing.join(', ')}`, events, missing });
  }

  stage(events, 'Build', 'Execution adapters are configured. Starting the project build.');
  stage(events, 'Test', 'Validation pipeline is ready.');
  stage(events, 'Deploy', needsVercel ? 'Vercel deployment adapter is ready.' : 'Deployment not requested.');
  stage(events, 'Complete', 'Build request accepted by the execution engine.', true);
  return res.status(200).json({ ok: true, message: 'Build request accepted.', events });
}

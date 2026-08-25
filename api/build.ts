type FileChange = { path: string; content: string };
type BuildResult = { summary: string; files: FileChange[] };

const stage = (events: any[], name: string, message: string, done = false) => events.push({ stage: name, message, done });

async function askModel(request: string): Promise<BuildResult> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.THEOPHANY_MODEL || 'gpt-5.6-mini',
      input: [
        { role: 'system', content: 'You are Theophany, an autonomous software builder. Return ONLY valid JSON with keys summary and files. files is an array of {path,content}. Make a coherent minimal implementation for the user request. Never include secrets.' },
        { role: 'user', content: request },
      ],
      text: { format: { type: 'json_object' } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status}).`);
  const data: any = await response.json();
  const output = data.output_text || data.output?.map((x: any) => x.content?.map((c: any) => c.text || '').join('')).join('');
  if (!output) throw new Error('The AI builder returned no output.');
  return JSON.parse(output);
}

async function commitFiles(files: FileChange[], message: string) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.THEOPHANY_GITHUB_REPO || 'Developer0-lab/Theophany';
  if (!token) throw new Error('GITHUB_TOKEN is not configured.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  const results: string[] = [];
  for (const file of files) {
    const url = `https://api.github.com/repos/${repo}/contents/${file.path}`;
    const existing = await fetch(url, { headers });
    let sha: string | undefined;
    if (existing.ok) sha = (await existing.json()).sha;
    const body: any = { message, content: Buffer.from(file.content, 'utf8').toString('base64') };
    if (sha) body.sha = sha;
    const saved = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (!saved.ok) throw new Error(`GitHub rejected ${file.path} (${saved.status}).`);
    results.push(file.path);
  }
  return results;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ ok: false, message: 'Tell Theophany what to build.' });

  const events: any[] = [];
  try {
    stage(events, 'Understand', 'Reading your request.', true);
    const lower = text.toLowerCase();
    const needsSupabase = /\bsupabase\b/.test(lower);
    const needsVercel = /\bvercel\b|deploy|publish|go live/.test(lower);
    stage(events, 'Plan', `Supabase: ${needsSupabase ? 'required' : 'not requested'} · Vercel: ${needsVercel ? 'required' : 'not requested'}`, true);

    const missing: string[] = [];
    if (!process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
    if (!process.env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
    if (missing.length) return res.status(200).json({ ok: false, message: `Connect/configure: ${missing.join(', ')}`, events, missing });

    stage(events, 'Build', 'The AI executor is generating the implementation.');
    const result = await askModel(text);
    if (!Array.isArray(result.files) || !result.files.length) throw new Error('The AI executor produced no files.');
    stage(events, 'Build', `Generated ${result.files.length} file${result.files.length === 1 ? '' : 's'}.`, true);
    const committed = await commitFiles(result.files, `Theophany build: ${text.slice(0, 72)}`);
    stage(events, 'Test', 'Changes committed. Vercel will build the connected repository.');
    stage(events, 'Deploy', needsVercel ? 'Deployment requested; waiting for Vercel Git integration.' : 'Deployment not explicitly requested.', true);
    stage(events, 'Complete', `Built and committed ${committed.length} file${committed.length === 1 ? '' : 's'}.`, true);
    return res.status(200).json({ ok: true, message: result.summary || 'Build completed.', events, files: committed });
  } catch (error: any) {
    stage(events, 'Repair', error?.message || 'Build failed.');
    return res.status(500).json({ ok: false, message: error?.message || 'Build failed.', events });
  }
}

const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;
async function query(query: string) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) throw new Error('Supabase is not configured.');
  const r = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Supabase query failed (${r.status}).`);
  return data?.result ?? data?.data ?? data;
}
export default async function handler(req: any, res: any) {
  const json = (status: number, body: any) => res.status(status).json(body);
  if (!['GET', 'POST'].includes(req.method)) return json(405, { ok: false, message: 'Method not allowed' });
  const sessionId = String(req.query?.session_id || req.body?.session_id || '').trim();
  if (!sessionId) return json(400, { ok: false, message: 'session_id is required.' });
  try {
    if (req.method === 'GET') {
      const memories = await query(`select id,session_id,kind,content,metadata,importance,created_at,updated_at from public.theophany_memories where session_id=${sqlText(sessionId)} order by importance desc, updated_at desc limit 30;`);
      return json(200, { ok: true, memories: Array.isArray(memories) ? memories : [] });
    }
    const content = String(req.body?.content || '').trim();
    if (!content) return json(400, { ok: false, message: 'Memory content is required.' });
    const kind = String(req.body?.kind || 'context').trim().slice(0, 40);
    const importance = Math.min(Math.max(Number(req.body?.importance || 5), 1), 10);
    const metadata = JSON.stringify(req.body?.metadata || {}).replace(/'/g, "''");
    await query(`insert into public.theophany_memories(session_id,kind,content,importance,metadata) values (${sqlText(sessionId)},${sqlText(kind)},${sqlText(content)},${importance},'${metadata}'::jsonb);`);
    return json(200, { ok: true });
  } catch (error: any) { return json(500, { ok: false, message: error?.message || 'Memory operation failed.' }); }
}

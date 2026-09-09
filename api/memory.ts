export const config = { runtime: 'nodejs' };

const sqlText = (value: string) => `'${String(value).replace(/'/g, "''")}'`;

async function query(sql: string) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) throw new Error('Supabase is not configured.');

  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`Supabase query failed (${response.status}).`);
  return data?.result ?? data?.data ?? data;
}

function readBody(req: any) {
  if (!req?.body) return {};
  if (typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export default async function handler(req: any, res: any) {
  const json = (status: number, body: any) => res.status(status).json(body);
  try {
    if (!['GET', 'POST'].includes(req.method)) return json(405, { ok: false, message: 'Method not allowed' });

    const body = readBody(req);
    const sessionId = String(req.query?.session_id || body.session_id || '').trim();
    if (!sessionId) return json(400, { ok: false, message: 'session_id is required.' });

    if (req.method === 'GET') {
      const memories = await query(`select id,session_id,kind,content,metadata,importance,created_at,updated_at from public.theophany_memories where session_id=${sqlText(sessionId)} order by importance desc, updated_at desc limit 30;`);
      return json(200, { ok: true, memories: Array.isArray(memories) ? memories : [] });
    }

    const content = String(body.content || '').trim();
    if (!content) return json(400, { ok: false, message: 'Memory content is required.' });
    const kind = String(body.kind || 'context').trim().slice(0, 40) || 'context';
    const rawImportance = Number(body.importance ?? 5);
    const importance = Math.min(Math.max(Number.isFinite(rawImportance) ? rawImportance : 5, 1), 10);
    const metadata = JSON.stringify(body.metadata || {}).replace(/'/g, "''");

    await query(`insert into public.theophany_memories(session_id,kind,content,importance,metadata) values (${sqlText(sessionId)},${sqlText(kind)},${sqlText(content)},${importance},'${metadata}'::jsonb);`);
    return json(200, { ok: true });
  } catch (error: any) {
    console.error('THEOPHANY_MEMORY_ERROR', error);
    return json(500, { ok: false, message: error?.message || 'Memory operation failed.' });
  }
}

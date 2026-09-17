export const config = { runtime: 'nodejs' };

const sqlText = (value: string) => "'" + String(value).split("'").join("''") + "'";

async function query(sql: string) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) throw new Error('Supabase is not configured.');

  const response = await fetch('https://api.supabase.com/v1/projects/' + encodeURIComponent(ref) + '/database/query', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error('Supabase query failed (' + response.status + ').');
  return data?.result ?? data?.data ?? data;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  const sessionId = String(req.query?.session_id || '').trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: 'session_id is required.' });
  try {
    const sql = 'select provider,status,expires_at,scopes,metadata,updated_at from public.theophany_integrations where session_id=' + sqlText(sessionId) + ' order by provider;';
    const rows: any = await query(sql);
    return res.status(200).json({ ok: true, integrations: Array.isArray(rows) ? rows : [] });
  } catch (error: any) {
    console.error('THEOPHANY_INTEGRATIONS_ERROR', error);
    return res.status(503).json({ ok: false, integrations: [], setup_required: true, message: error?.message || 'Integration storage is not ready.' });
  }
}

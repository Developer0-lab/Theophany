export const config = { runtime: 'nodejs' };

function auth() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error('Vercel domain access is not configured.');
  return token;
}

async function vercel(path: string, init: RequestInit = {}) {
  const token = auth();
  const response = await fetch('https://api.vercel.com' + path, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `Vercel returned HTTP ${response.status}.`);
  }
  return data;
}

function cleanName(value: unknown) {
  const name = String(value || '').trim().toLowerCase();
  if (!name || name.length > 253 || !/^[a-z0-9.-]+$/.test(name) || name.startsWith('.') || name.endsWith('.')) {
    throw new Error('A valid domain name is required.');
  }
  return name;
}

export default async function handler(req: any, res: any) {
  try {
    const action = String(req.query?.action || 'availability');

    if (action === 'availability') {
      if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed.' });
      const name = cleanName(req.query?.name);
      const data = await vercel('/v1/registrar/domains/' + encodeURIComponent(name) + '/availability');
      return res.status(200).json({ ok: true, domain: name, ...data });
    }

    if (action === 'attach') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed.' });
      const body = req.body || {};
      const name = cleanName(body.domain);
      const projectId = String(body.project_id || process.env.VERCEL_PROJECT_ID || '').trim();
      if (!projectId) return res.status(400).json({ ok: false, message: 'project_id is required.' });
      const teamId = String(body.team_id || process.env.VERCEL_TEAM_ID || '').trim();
      const query = teamId ? '?teamId=' + encodeURIComponent(teamId) : '';
      const data = await vercel('/v9/projects/' + encodeURIComponent(projectId) + '/domains' + query, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      return res.status(200).json({ ok: true, domain: name, project_id: projectId, ...data });
    }

    if (action === 'verify') {
      if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed.' });
      const body = req.body || {};
      const name = cleanName(body.domain);
      const projectId = String(body.project_id || process.env.VERCEL_PROJECT_ID || '').trim();
      if (!projectId) return res.status(400).json({ ok: false, message: 'project_id is required.' });
      const teamId = String(body.team_id || process.env.VERCEL_TEAM_ID || '').trim();
      const query = teamId ? '?teamId=' + encodeURIComponent(teamId) : '';
      const data = await vercel('/v9/projects/' + encodeURIComponent(projectId) + '/domains/' + encodeURIComponent(name) + '/verify' + query, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      return res.status(200).json({ ok: true, domain: name, ...data });
    }

    return res.status(400).json({ ok: false, message: 'Unsupported domain action.' });
  } catch (error: any) {
    return res.status(503).json({ ok: false, message: error?.message || 'Domain service is not ready.' });
  }
}

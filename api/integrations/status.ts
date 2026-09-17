import { getIntegrationStatuses } from '../../lib/integrations/oauth';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  try {
    const sessionId = String(req.query?.session_id || '').trim();
    if (!sessionId) return res.status(400).json({ ok: false, message: 'session_id is required.' });
    const rows = await getIntegrationStatuses(sessionId);
    return res.status(200).json({ ok: true, integrations: rows.map((x: any) => ({ provider: x.provider, status: x.status, expires_at: x.expires_at, scopes: x.scopes, metadata: x.metadata, updated_at: x.updated_at })) });
  } catch (error: any) { return res.status(500).json({ ok: false, message: error?.message || 'Could not read integrations.' }); }
}

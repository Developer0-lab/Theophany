import { getIntegrationStatuses } from '../lib/integrations/oauth';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  const sessionId = String(req.query?.session_id || '').trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: 'session_id is required.' });
  try {
    const integrations = await getIntegrationStatuses(sessionId);
    return res.status(200).json({ ok: true, integrations });
  } catch (error: any) {
    return res.status(503).json({ ok: false, integrations: [], setup_required: true, message: error?.message || 'Integration storage is not ready.' });
  }
}

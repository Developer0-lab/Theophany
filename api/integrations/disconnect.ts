import { disconnectIntegration } from '../../lib/integrations/oauth';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  try {
    const sessionId = String(req.body?.session_id || '').trim();
    const provider = String(req.body?.provider || '').trim();
    if (!sessionId || !provider) return res.status(400).json({ ok: false, message: 'session_id and provider are required.' });
    await disconnectIntegration(sessionId, provider);
    return res.status(200).json({ ok: true });
  } catch (error: any) { return res.status(500).json({ ok: false, message: error?.message || 'Could not disconnect integration.' }); }
}

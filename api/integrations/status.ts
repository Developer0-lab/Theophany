export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  const sessionId = String(req.query?.session_id || '').trim();
  if (!sessionId) return res.status(400).json({ ok: false, message: 'session_id is required.' });
  return res.status(200).json({ ok: true, integrations: [], setup_required: true });
}
